import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { normalizeOpenAICompatibleBaseUrl } from '../../config/auth-utils';
import type { BuildingCodeIndex } from './index-store';
import type { CodeChunkRecord, CodeVectorRecord } from './types';

export interface BuildingCodeEmbeddingClient {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface BuildingCodeEmbeddingConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeoutMs: number;
}

export interface EmbeddingCacheKeyInput {
  model: string;
  sourceChecksum: string;
  nodeId: string;
  text: string;
}

export function buildEmbeddingCacheKey(input: EmbeddingCacheKeyInput): string {
  return `${input.model}:sha256:${sha256([input.sourceChecksum, input.nodeId, input.text].join('\n'))}`;
}

export function buildEmbeddingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BuildingCodeEmbeddingConfig {
  const apiKey = env.BUILDING_CODE_EMBEDDING_API_KEY || env.OPENAI_API_KEY || '';
  const baseUrl = normalizeOpenAICompatibleBaseUrl(
    env.BUILDING_CODE_EMBEDDING_BASE_URL || env.OPENAI_BASE_URL
  );
  const model = env.BUILDING_CODE_EMBEDDING_MODEL || 'text-embedding-3-small';
  const timeoutMs = Number(env.BUILDING_CODE_EMBEDDING_TIMEOUT_MS || 180000);

  if (!apiKey) {
    throw new Error(
      'Building-code semantic search requires BUILDING_CODE_EMBEDDING_API_KEY or OPENAI_API_KEY'
    );
  }

  return {
    apiKey,
    baseUrl,
    model,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180000,
  };
}

export function createOpenAIEmbeddingClient(
  config: BuildingCodeEmbeddingConfig = buildEmbeddingConfigFromEnv()
): BuildingCodeEmbeddingClient {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
  });

  return {
    model: config.model,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) {
        return [];
      }

      const response = await client.embeddings.create({
        model: config.model,
        input: texts,
      });

      return response.data.map((item) => item.embedding);
    },
  };
}

export async function embedMissingChunks(
  index: Pick<BuildingCodeIndex, 'chunks' | 'vectors'>,
  client: BuildingCodeEmbeddingClient
): Promise<CodeVectorRecord[]> {
  const existingChunks = new Set(
    index.vectors.map((vector) =>
      vectorChunkKey(vector.embeddingTextHash, vector.embeddingModel, vector.chunkId)
    )
  );
  const reusableVectors = new Map(
    index.vectors.map((vector) => [vectorKey(vector.embeddingTextHash, vector.embeddingModel), vector])
  );
  const relinked: CodeVectorRecord[] = [];
  const missingChunks: CodeChunkRecord[] = [];

  for (const chunk of index.chunks) {
    const chunkVectorKey = vectorChunkKey(chunk.embeddingCacheKey, client.model, chunk.chunkId);

    if (existingChunks.has(chunkVectorKey)) {
      continue;
    }

    const reusable = reusableVectors.get(vectorKey(chunk.embeddingCacheKey, client.model));

    if (reusable) {
      relinked.push({
        chunkId: chunk.chunkId,
        embeddingModel: client.model,
        embedding: [...reusable.embedding],
        embeddingTextHash: chunk.embeddingCacheKey,
      });
      continue;
    }

    missingChunks.push(chunk);
  }

  if (missingChunks.length === 0 && relinked.length === 0) {
    return [];
  }

  const embeddings = missingChunks.length > 0
    ? await client.embed(missingChunks.map((chunk) => chunk.text))
    : [];
  validateEmbeddingBatch(embeddings, missingChunks.length);

  const embedded = missingChunks.map((chunk, index) => vectorForChunk(chunk, client.model, embeddings[index]));
  const created = [...relinked, ...embedded];

  index.vectors.push(...created);

  return created;
}

function validateEmbeddingBatch(embeddings: number[][], expectedLength: number): void {
  if (embeddings.length !== expectedLength) {
    throw new Error(`Embedding client returned ${embeddings.length} embeddings for ${expectedLength} chunks`);
  }

  let expectedDimension: number | undefined;

  for (let index = 0; index < embeddings.length; index++) {
    const embedding = embeddings[index];

    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(`Embedding client returned an invalid embedding at index ${index}`);
    }

    expectedDimension ??= embedding.length;

    if (embedding.length !== expectedDimension) {
      throw new Error(`Embedding client returned inconsistent embedding dimensions at index ${index}`);
    }
  }
}

function vectorForChunk(
  chunk: CodeChunkRecord,
  embeddingModel: string,
  embedding: number[]
): CodeVectorRecord {
  return {
    chunkId: chunk.chunkId,
    embeddingModel,
    embedding,
    embeddingTextHash: chunk.embeddingCacheKey,
  };
}

function vectorKey(chunkCacheKey: string, model: string): string {
  return `${model}:${chunkCacheKey}`;
}

function vectorChunkKey(chunkCacheKey: string, model: string, chunkId: string): string {
  return `${vectorKey(chunkCacheKey, model)}:${chunkId}`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
