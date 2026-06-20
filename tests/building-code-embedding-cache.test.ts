import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildEmbeddingCacheKey,
  buildEmbeddingConfigFromEnv,
  embedMissingChunks,
} from '../src/main/mcp/building-code/embedding';
import { ingestMarkdownFixture } from '../src/main/mcp/building-code/ingest';
import type { CodeVectorRecord } from '../src/main/mcp/building-code/types';

const fixturePath = path.resolve(
  __dirname,
  '../src/main/mcp/building-code/fixtures/nbc-2025-refrigerant-excerpt.md'
);

class FakeEmbeddingClient {
  calls: string[] = [];
  model = 'text-embedding-3-small';

  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push(...texts);

    return texts.map((text) => [
      text.toLowerCase().includes('r-32') ? 1 : 0,
      text.toLowerCase().includes('edvc') ? 1 : 0,
      text.toLowerCase().includes('flammable') ? 1 : 0,
    ]);
  }
}

function fixtureIndex(vectors: CodeVectorRecord[] = []) {
  const markdown = fs.readFileSync(fixturePath, 'utf8');

  return {
    ...ingestMarkdownFixture(markdown, {
      sourceId: 'ashrae-15-2022-synthetic',
      codeFamily: 'ASHRAE 15',
      edition: '2022',
      jurisdictionScope: 'synthetic-fixture',
      sourceTitle: 'ASHRAE 15 2022 Synthetic Excerpt',
      sourceUrl: 'fixture://nbc-2025-refrigerant-excerpt.md',
    }),
    vectors,
  };
}

describe('building-code embedding cache', () => {
  it('resolves OpenAI-compatible embedding config from building-code env with OpenAI fallback', () => {
    expect(
      buildEmbeddingConfigFromEnv({
        OPENAI_API_KEY: 'sk-openai',
        OPENAI_BASE_URL: 'https://relay.example.test/v1',
      } as NodeJS.ProcessEnv)
    ).toMatchObject({
      apiKey: 'sk-openai',
      baseUrl: 'https://relay.example.test/v1',
      model: 'text-embedding-3-small',
      timeoutMs: 180000,
    });

    expect(
      buildEmbeddingConfigFromEnv({
        OPENAI_API_KEY: 'sk-openai',
        OPENAI_BASE_URL: 'https://relay.example.test/v1',
        BUILDING_CODE_EMBEDDING_API_KEY: 'sk-building',
        BUILDING_CODE_EMBEDDING_BASE_URL: 'https://building.example.test/v1',
        BUILDING_CODE_EMBEDDING_MODEL: 'building-embedding-model',
        BUILDING_CODE_EMBEDDING_TIMEOUT_MS: '9000',
      } as NodeJS.ProcessEnv)
    ).toMatchObject({
      apiKey: 'sk-building',
      baseUrl: 'https://building.example.test/v1',
      model: 'building-embedding-model',
      timeoutMs: 9000,
    });
  });

  it('builds deterministic cache keys from source checksum, node id, text, and model', () => {
    expect(
      buildEmbeddingCacheKey({
        model: 'text-embedding-3-small',
        sourceChecksum: 'sha256:source',
        nodeId: 'node-1',
        text: 'hello',
      })
    ).toMatch(/^text-embedding-3-small:sha256:[a-f0-9]{64}$/);
  });

  it('embeds only chunks missing cached vectors', async () => {
    const fakeClient = new FakeEmbeddingClient();
    const index = fixtureIndex();

    const created = await embedMissingChunks(index, fakeClient);

    expect(created).toHaveLength(index.chunks.length);
    expect(fakeClient.calls).toHaveLength(index.chunks.length);

    const secondClient = new FakeEmbeddingClient();
    const indexWithVectors = fixtureIndex(created);

    await expect(embedMissingChunks(indexWithVectors, secondClient)).resolves.toHaveLength(0);
    expect(secondClient.calls).toHaveLength(0);
  });

  it('relinks a reusable cached embedding to the current chunk id', async () => {
    const fakeClient = new FakeEmbeddingClient();
    const index = fixtureIndex();
    const [currentChunk, ...remainingChunks] = index.chunks;
    const reusedEmbedding = [0.25, 0.5, 0.75];
    const staleVector: CodeVectorRecord = {
      chunkId: 'stale-chunk-id',
      embeddingModel: fakeClient.model,
      embedding: reusedEmbedding,
      embeddingTextHash: currentChunk.embeddingCacheKey,
    };

    index.vectors.push(staleVector);

    const created = await embedMissingChunks(index, fakeClient);

    expect(fakeClient.calls).toEqual(remainingChunks.map((chunk) => chunk.text));
    expect(created).toContainEqual({
      chunkId: currentChunk.chunkId,
      embeddingModel: fakeClient.model,
      embedding: reusedEmbedding,
      embeddingTextHash: currentChunk.embeddingCacheKey,
    });
    expect(index.vectors).toContainEqual({
      chunkId: currentChunk.chunkId,
      embeddingModel: fakeClient.model,
      embedding: reusedEmbedding,
      embeddingTextHash: currentChunk.embeddingCacheKey,
    });
    expect(index.vectors).not.toContainEqual(staleVector);
    expect(
      index.vectors.filter((vector) =>
        vector.chunkId === currentChunk.chunkId &&
        vector.embeddingModel === fakeClient.model &&
        vector.embeddingTextHash === currentChunk.embeddingCacheKey
      )
    ).toHaveLength(1);
  });

  it('prunes stale duplicate vectors when the current vector already exists', async () => {
    const fakeClient = new FakeEmbeddingClient();
    const index = fixtureIndex();
    const [currentChunk, ...remainingChunks] = index.chunks;
    const currentVector: CodeVectorRecord = {
      chunkId: currentChunk.chunkId,
      embeddingModel: fakeClient.model,
      embedding: [0.25, 0.5, 0.75],
      embeddingTextHash: currentChunk.embeddingCacheKey,
    };
    const staleVector: CodeVectorRecord = {
      chunkId: 'stale-chunk-id',
      embeddingModel: fakeClient.model,
      embedding: [0.25, 0.5, 0.75],
      embeddingTextHash: currentChunk.embeddingCacheKey,
    };

    index.vectors.push(currentVector, staleVector);

    await embedMissingChunks(index, fakeClient);

    expect(fakeClient.calls).toEqual(remainingChunks.map((chunk) => chunk.text));
    expect(index.vectors).toContainEqual(currentVector);
    expect(index.vectors).not.toContainEqual(staleVector);
  });

  it('uses stable embedding cache keys across rebuilds for unchanged source checksum, node id, text, and model', () => {
    const first = fixtureIndex();
    const second = fixtureIndex();

    expect(first.chunks.map((chunk) => chunk.embeddingCacheKey)).toEqual(
      second.chunks.map((chunk) => chunk.embeddingCacheKey)
    );
    expect(buildEmbeddingCacheKey({
      model: 'text-embedding-3-small',
      sourceChecksum: 'sha256:source',
      nodeId: 'node-1',
      text: 'same text',
    })).toBe(
      buildEmbeddingCacheKey({
        model: 'text-embedding-3-small',
        sourceChecksum: 'sha256:source',
        nodeId: 'node-1',
        text: 'same text',
      })
    );
  });

  it('returns embedding failure diagnostics without appending partial vectors', async () => {
    const index = fixtureIndex();
    const failingClient = {
      model: 'text-embedding-3-small',
      embed: async () => {
        throw new Error('embedding endpoint down');
      },
    };

    await expect(embedMissingChunks(index, failingClient)).rejects.toThrow('embedding endpoint down');
    expect(index.vectors).toEqual([]);
  });

  it('rejects partial embedding batches without appending corrupt vectors', async () => {
    const index = fixtureIndex();
    const originalVectors = [...index.vectors];
    const expectedCount = index.chunks.length;
    const returnedCount = expectedCount - 1;
    const partialClient = {
      model: 'text-embedding-3-small',
      embed: async (texts: string[]) => texts.slice(1).map(() => [1, 0, 0]),
    };

    await expect(embedMissingChunks(index, partialClient)).rejects.toThrow(
      `Embedding client returned ${returnedCount} embeddings for ${expectedCount} chunks`
    );
    expect(index.vectors).toEqual(originalVectors);
  });

  it('rejects empty embedding vectors without appending corrupt vectors', async () => {
    const index = fixtureIndex();
    const originalVectors = [...index.vectors];
    const emptyVectorClient = {
      model: 'text-embedding-3-small',
      embed: async (texts: string[]) => texts.map(() => []),
    };

    await expect(embedMissingChunks(index, emptyVectorClient)).rejects.toThrow(
      'Embedding client returned an invalid embedding at index 0'
    );
    expect(index.vectors).toEqual(originalVectors);
  });

  it('rejects ragged embedding dimensions without appending corrupt vectors', async () => {
    const index = fixtureIndex();
    const originalVectors = [...index.vectors];
    const raggedClient = {
      model: 'text-embedding-3-small',
      embed: async (texts: string[]) => texts.map((_, index) => (index === 0 ? [1, 0] : [1])),
    };

    await expect(embedMissingChunks(index, raggedClient)).rejects.toThrow(
      'Embedding client returned inconsistent embedding dimensions at index 1'
    );
    expect(index.vectors).toEqual(originalVectors);
  });
});
