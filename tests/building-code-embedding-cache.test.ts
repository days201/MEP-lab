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

  it('builds deterministic cache keys from model and text', () => {
    expect(buildEmbeddingCacheKey('text-embedding-3-small', 'hello')).toMatch(
      /^text-embedding-3-small:sha256:[a-f0-9]{64}$/
    );
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
});
