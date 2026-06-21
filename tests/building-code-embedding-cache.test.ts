import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildEmbeddingCacheKey,
  buildEmbeddingConfigFromEnv,
  createOpenAIEmbeddingClient,
  embedMissingChunks,
  normalizeOpenAICompatibleEmbeddingsResponse,
  testEmbeddingSettings,
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

async function captureError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  throw new Error('Expected action to reject');
}

describe('building-code embedding cache', () => {
  it('embeds OpenRouter-compatible responses through the provider-aware request path', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createOpenAIEmbeddingClient({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/text-embedding-3-small',
      timeoutMs: 9000,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({
          data: [
            { object: 'embedding', index: 0, embedding: [0.1, 0.2] },
            { object: 'embedding', index: 1, embedding: [0.3, 0.4] },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await expect(client.embed(['alpha', 'beta'])).resolves.toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://openrouter.ai/api/v1/embeddings');
    expect(requests[0].init.method).toBe('POST');
    expect(requests[0].init.headers).toMatchObject({
      Authorization: 'Bearer sk-or-v1-secret',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      model: 'openai/text-embedding-3-small',
      input: ['alpha', 'beta'],
    });
  });

  it('sends Gemini Embedding 2 document chunks as single-input OpenRouter requests with default dimensions', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createOpenAIEmbeddingClient({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-embedding-2',
      timeoutMs: 9000,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        const input = JSON.parse(String(init?.body)).input;
        const value = input === 'alpha' ? [0.1, 0.2] : [0.3, 0.4];
        return new Response(JSON.stringify({
          data: [{ object: 'embedding', index: 0, embedding: value }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    const index = {
      chunks: [
        {
          chunkId: 'chunk-alpha',
          sourceId: 'source',
          nodeId: 'node-alpha',
          sectionPath: ['Alpha'],
          title: 'Alpha',
          text: 'alpha',
          ordinal: 0,
          tokens: 1,
          embeddingCacheKey: 'cache-alpha',
        },
        {
          chunkId: 'chunk-beta',
          sourceId: 'source',
          nodeId: 'node-beta',
          sectionPath: ['Beta'],
          title: 'Beta',
          text: 'beta',
          ordinal: 1,
          tokens: 1,
          embeddingCacheKey: 'cache-beta',
        },
      ],
      vectors: [],
    };

    const created = await embedMissingChunks(index, client);

    expect(created).toEqual([
      {
        chunkId: 'chunk-alpha',
        embeddingModel: 'google/gemini-embedding-2',
        embedding: [0.1, 0.2],
        embeddingTextHash: 'cache-alpha',
      },
      {
        chunkId: 'chunk-beta',
        embeddingModel: 'google/gemini-embedding-2',
        embedding: [0.3, 0.4],
        embeddingTextHash: 'cache-beta',
      },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => JSON.parse(String(request.init.body)))).toEqual([
      { model: 'google/gemini-embedding-2', input: 'alpha', dimensions: 768 },
      { model: 'google/gemini-embedding-2', input: 'beta', dimensions: 768 },
    ]);
  });

  it('keeps OpenAI-compatible embedding requests batched without dimensions unless explicitly configured', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createOpenAIEmbeddingClient({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/text-embedding-3-small',
      timeoutMs: 9000,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({
          data: [
            { object: 'embedding', index: 0, embedding: [0.1, 0.2] },
            { object: 'embedding', index: 1, embedding: [0.3, 0.4] },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await expect(client.embed(['alpha', 'beta'])).resolves.toEqual([[0.1, 0.2], [0.3, 0.4]]);

    expect(requests).toHaveLength(1);
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      model: 'openai/text-embedding-3-small',
      input: ['alpha', 'beta'],
    });
  });

  it('includes explicitly configured dimensions for non-Gemini embedding requests', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createOpenAIEmbeddingClient({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/text-embedding-3-small',
      dimensions: 512,
      timeoutMs: 9000,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({
          data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await expect(client.embed(['alpha'])).resolves.toEqual([[0.1, 0.2]]);

    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      model: 'openai/text-embedding-3-small',
      input: ['alpha'],
      dimensions: 512,
    });
  });

  it('surfaces sanitized OpenRouter HTTP error details before compatibility errors', async () => {
    const client = createOpenAIEmbeddingClient({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-embedding-2',
      timeoutMs: 9000,
      fetch: async () =>
        new Response(JSON.stringify({
          error: {
            message: 'No endpoints found for requested embedding model',
            code: 404,
          },
        }), { status: 404, headers: { 'content-type': 'application/json' } }),
    });

    await expect(client.embed(['probe'])).rejects.toThrow(
      'OpenRouter embeddings request failed with HTTP 404 (provider=openrouter, model=google/gemini-embedding-2, endpoint=openrouter.ai/api/v1/embeddings, code=404): No endpoints found for requested embedding model'
    );
  });

  it('surfaces sanitized OpenRouter HTTP-OK error bodies before compatibility errors', async () => {
    const sensitiveText = 'sensitive\ndocument   text';
    const client = createOpenAIEmbeddingClient({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-embedding-2',
      timeoutMs: 9000,
      fetch: async () =>
        new Response(JSON.stringify({
          error: {
            message: 'Provider rejected key sk-or-v1-secret for sensitive document text',
            code: 'provider_error',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    const error = await captureError(() => client.embed([sensitiveText]));

    expect(error.message).toContain(
      'OpenRouter embeddings request failed (provider=openrouter, model=google/gemini-embedding-2, endpoint=openrouter.ai/api/v1/embeddings, code=provider_error): Provider rejected key [redacted-key] for [redacted-input]'
    );
    expect(error.message).not.toContain('sk-or-v1-secret');
    expect(error.message).not.toContain('sensitive document text');
    expect(error.message).not.toContain(sensitiveText);
    expect(error.message).not.toContain('OpenRouter embeddings response did not include data[].embedding');
  });

  it('redacts escaped submitted text echoed in OpenRouter error messages', async () => {
    const sensitiveText = 'sensitive\ndocument\t text';
    const escapedSensitiveText = JSON.stringify(sensitiveText).slice(1, -1);
    const client = createOpenAIEmbeddingClient({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-embedding-2',
      timeoutMs: 9000,
      fetch: async () =>
        new Response(JSON.stringify({
          error: {
            message: `Provider echoed ${escapedSensitiveText}`,
            code: 'provider_error',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    const error = await captureError(() => client.embed([sensitiveText]));

    expect(error.message).toContain('Provider echoed [redacted-input]');
    expect(error.message).not.toContain(escapedSensitiveText);
    expect(error.message).not.toContain(sensitiveText);
  });

  it('does not stringify arbitrary OpenRouter error body fields into diagnostics', async () => {
    const sensitiveText = 'sensitive\ndocument\t text';
    const client = createOpenAIEmbeddingClient({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-embedding-2',
      timeoutMs: 9000,
      fetch: async () =>
        new Response(JSON.stringify({
          error: {
            details: sensitiveText,
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    const error = await captureError(() => client.embed([sensitiveText]));

    expect(error.message).toBe(
      'OpenRouter embeddings request failed (provider=openrouter, model=google/gemini-embedding-2, endpoint=openrouter.ai/api/v1/embeddings): OpenRouter returned an error body without a message'
    );
    expect(error.message).not.toContain('sensitive');
    expect(error.message).not.toContain('sensitive\\ndocument\\t text');
    expect(error.message).not.toContain(sensitiveText);
  });

  it('includes numeric zero OpenRouter error codes in diagnostics', async () => {
    const client = createOpenAIEmbeddingClient({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-embedding-2',
      timeoutMs: 9000,
      fetch: async () =>
        new Response(JSON.stringify({
          error: {
            message: 'Provider returned zero code',
            code: 0,
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    const error = await captureError(() => client.embed(['probe']));

    expect(error.message).toContain(
      'OpenRouter embeddings request failed (provider=openrouter, model=google/gemini-embedding-2, endpoint=openrouter.ai/api/v1/embeddings, code=0): Provider returned zero code'
    );
  });

  it('describes unexpected OpenRouter response shapes without exposing secrets or text', async () => {
    const client = createOpenAIEmbeddingClient({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-embedding-2',
      timeoutMs: 9000,
      fetch: async () =>
        new Response(JSON.stringify({
          data: [{ index: 0, object: 'embedding' }],
          usage: { prompt_tokens: 2 },
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    await expect(client.embed(['sensitive document text'])).rejects.toThrow(
      'OpenRouter embeddings response did not include data[].embedding (provider=openrouter, model=google/gemini-embedding-2, endpoint=openrouter.ai/api/v1/embeddings, top-level keys: data, usage, data[0] keys: index, object)'
    );
    await expect(client.embed(['sensitive document text'])).rejects.not.toThrow('sk-or-v1-secret');
    await expect(client.embed(['sensitive document text'])).rejects.not.toThrow('sensitive document text');
  });

  it('probes embedding settings with a short text and reports vector dimensions', async () => {
    const result = await testEmbeddingSettings({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-embedding-2',
      timeoutMs: 9000,
      fetch: async () =>
        new Response(JSON.stringify({
          data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    expect(result).toEqual({ ok: true, dimensions: 3 });
  });

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
        BUILDING_CODE_EMBEDDING_DIMENSIONS: '512',
        BUILDING_CODE_EMBEDDING_TIMEOUT_MS: '9000',
      } as NodeJS.ProcessEnv)
    ).toMatchObject({
      apiKey: 'sk-building',
      baseUrl: 'https://building.example.test/v1',
      model: 'building-embedding-model',
      dimensions: 512,
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

  it('rejects non-OpenAI-compatible embedding responses without appending vectors', async () => {
    const index = fixtureIndex();
    const originalVectors = [...index.vectors];
    const incompatibleClient = {
      model: 'text-embedding-3-small',
      embed: async () =>
        normalizeOpenAICompatibleEmbeddingsResponse({
          data: [{ index: 0 }],
        }),
    };

    await expect(embedMissingChunks(index, incompatibleClient)).rejects.toThrow(
      'Embedding provider returned an unexpected embeddings response; expected data[].embedding.'
    );
    expect(index.vectors).toEqual(originalVectors);
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
