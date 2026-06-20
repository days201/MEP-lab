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

export function buildEmbeddingCacheKey(model: string, text: string): string {
  return `${model}:sha256:${sha256(text)}`;
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
  const existing = new Set(index.vectors.map((vector) => vectorKey(vector.chunkId, vector.embeddingModel)));
  const missingChunks = index.chunks.filter(
    (chunk) => !existing.has(vectorKey(chunk.chunkId, client.model))
  );

  if (missingChunks.length === 0) {
    return [];
  }

  const embeddings = await client.embed(missingChunks.map((chunk) => chunk.text));
  const created = missingChunks.map((chunk, index) => vectorForChunk(chunk, client.model, embeddings[index]));

  index.vectors.push(...created);

  return created;
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
    embeddingTextHash: `sha256:${sha256(chunk.text)}`,
  };
}

function vectorKey(chunkId: string, model: string): string {
  return `${model}:${chunkId}`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
