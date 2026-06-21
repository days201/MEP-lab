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
  provider?: 'openai' | 'openrouter' | 'ollama' | 'custom' | string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  dimensions?: number;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export interface EmbeddingCacheKeyInput {
  model: string;
  sourceChecksum: string;
  nodeId: string;
  text: string;
}

export type EmbeddingSettingsProbeResult =
  | { ok: true; dimensions: number }
  | { ok: false; error: string };

export function buildEmbeddingCacheKey(input: EmbeddingCacheKeyInput): string {
  return `${input.model}:sha256:${sha256([input.sourceChecksum, input.nodeId, input.text].join('\n'))}`;
}

export function buildEmbeddingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BuildingCodeEmbeddingConfig {
  const apiKey = env.BUILDING_CODE_EMBEDDING_API_KEY || env.OPENAI_API_KEY || '';
  const baseUrl = normalizeOpenAICompatibleBaseUrl(
    env.BUILDING_CODE_EMBEDDING_BASE_URL || env.OPENAI_BASE_URL
  );
  const model = env.BUILDING_CODE_EMBEDDING_MODEL || 'text-embedding-3-small';
  const dimensions = Number(env.BUILDING_CODE_EMBEDDING_DIMENSIONS);
  const timeoutMs = Number(env.BUILDING_CODE_EMBEDDING_TIMEOUT_MS || 180000);

  if (!apiKey) {
    throw new Error(
      'Building-code semantic search requires BUILDING_CODE_EMBEDDING_API_KEY or OPENAI_API_KEY'
    );
  }

  return {
    provider: providerFromBaseUrl(baseUrl),
    apiKey,
    baseUrl,
    model,
    ...(Number.isFinite(dimensions) && dimensions > 0 ? { dimensions: Math.round(dimensions) } : {}),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180000,
  };
}

export function createOpenAIEmbeddingClient(
  config: BuildingCodeEmbeddingConfig = buildEmbeddingConfigFromEnv()
): BuildingCodeEmbeddingClient {
  if (config.provider === 'openrouter') {
    return createFetchEmbeddingClient(config);
  }

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

      if (shouldEmbedOneInputPerRequest(config)) {
        const embeddings: number[][] = [];
        for (const text of texts) {
          const response = await client.embeddings.create(
            embeddingRequestBody(config.model, text, effectiveEmbeddingDimensions(config))
          );
          embeddings.push(...normalizeOpenAICompatibleEmbeddingsResponse(response, responseContext(config)));
        }
        return embeddings;
      }

      const response = await client.embeddings.create(
        embeddingRequestBody(config.model, texts, effectiveEmbeddingDimensions(config))
      );

      return normalizeOpenAICompatibleEmbeddingsResponse(response, responseContext(config));
    },
  };
}

export async function testEmbeddingSettings(
  config: BuildingCodeEmbeddingConfig
): Promise<EmbeddingSettingsProbeResult> {
  try {
    const [embedding] = await createOpenAIEmbeddingClient(config).embed([
      'MEP Lab embedding settings probe',
    ]);

    if (!Array.isArray(embedding) || embedding.length === 0) {
      return { ok: false, error: 'Embedding provider returned an empty probe vector.' };
    }

    return { ok: true, dimensions: embedding.length };
  } catch (error) {
    return { ok: false, error: sanitizeSummary(error instanceof Error ? error.message : String(error)) };
  }
}

function createFetchEmbeddingClient(config: BuildingCodeEmbeddingConfig): BuildingCodeEmbeddingClient {
  const requestFetch = config.fetch ?? fetch;
  const endpoint = embeddingsEndpoint(config.baseUrl);
  const context = responseContext(config, endpoint);

  return {
    model: config.model,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) {
        return [];
      }

      if (shouldEmbedOneInputPerRequest(config)) {
        const embeddings: number[][] = [];
        for (const text of texts) {
          embeddings.push(...await requestEmbeddings(text, [text]));
        }
        return embeddings;
      }

      return requestEmbeddings(texts, texts);
    },
  };

  async function requestEmbeddings(
    input: string | string[],
    redactedTexts: string[]
  ): Promise<number[][]> {
    const response = await requestFetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        embeddingRequestBody(config.model, input, effectiveEmbeddingDimensions(config))
      ),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    const body = await readResponseBody(response);
    const redactedValues = [config.apiKey, ...redactedTexts];

    if (!response.ok) {
      throw new Error(httpEmbeddingError(response.status, body, context, redactedValues));
    }

    if (hasResponseErrorBody(body)) {
      throw new Error(responseErrorBodyMessage(body, context, redactedValues));
    }

    return normalizeOpenAICompatibleEmbeddingsResponse(body, context);
  }
}

export function normalizeOpenAICompatibleEmbeddingsResponse(
  response: unknown,
  context: EmbeddingResponseContext = {}
): number[][] {
  const message = compatibilityMessage(response, context);

  if (!response || typeof response !== 'object' || !('data' in response)) {
    throw new Error(message);
  }

  const { data } = response as { data?: unknown };

  if (!Array.isArray(data)) {
    throw new Error(message);
  }

  return data.map((item, index) => normalizeEmbeddingItem(item, index, message));
}

export interface EmbeddingResponseContext {
  provider?: string;
  model?: string;
  endpoint?: string;
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
  const currentChunkIds = new Set(index.chunks.map((chunk) => chunk.chunkId));
  const relinkedVectorKeys = new Set<string>();
  const relinked: CodeVectorRecord[] = [];
  const missingChunks: CodeChunkRecord[] = [];

  for (const chunk of index.chunks) {
    const chunkVectorKey = vectorChunkKey(chunk.embeddingCacheKey, client.model, chunk.chunkId);
    const reusableVectorKey = vectorKey(chunk.embeddingCacheKey, client.model);

    if (existingChunks.has(chunkVectorKey)) {
      relinkedVectorKeys.add(reusableVectorKey);
      continue;
    }

    const reusable = reusableVectors.get(reusableVectorKey);

    if (reusable) {
      relinkedVectorKeys.add(reusableVectorKey);
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

  if (missingChunks.length === 0 && relinked.length === 0 && relinkedVectorKeys.size === 0) {
    return [];
  }

  const embeddings = missingChunks.length > 0
    ? await client.embed(missingChunks.map((chunk) => chunk.text))
    : [];
  validateEmbeddingBatch(embeddings, missingChunks.length);

  const embedded = missingChunks.map((chunk, index) => vectorForChunk(chunk, client.model, embeddings[index]));
  const created = [...relinked, ...embedded];

  if (relinkedVectorKeys.size > 0) {
    const retainedVectors = index.vectors.filter((vector) => {
      const key = vectorKey(vector.embeddingTextHash, vector.embeddingModel);

      if (!relinkedVectorKeys.has(key)) {
        return true;
      }

      return currentChunkIds.has(vector.chunkId) && !relinked.some((record) =>
        record.chunkId === vector.chunkId &&
        record.embeddingModel === vector.embeddingModel &&
        record.embeddingTextHash === vector.embeddingTextHash
      );
    });

    index.vectors.splice(0, index.vectors.length, ...retainedVectors);
  }

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

function normalizeEmbeddingItem(item: unknown, index: number, compatibilityMessage: string): number[] {
  if (!item || typeof item !== 'object' || !('embedding' in item)) {
    throw new Error(compatibilityMessage);
  }

  const embedding = (item as { embedding?: unknown }).embedding;

  if (!Array.isArray(embedding)) {
    throw new Error(`Embedding provider returned an invalid embedding at index ${index}`);
  }

  return embedding.map((value, dimension) => {
    if (!Number.isFinite(value)) {
      throw new Error(`Embedding provider returned an invalid embedding value at index ${index}:${dimension}`);
    }

    return value;
  });
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

function providerFromBaseUrl(baseUrl: string | undefined): BuildingCodeEmbeddingConfig['provider'] {
  if (!baseUrl) {
    return 'openai';
  }

  try {
    return new URL(baseUrl).hostname.toLowerCase().includes('openrouter.ai') ? 'openrouter' : 'openai';
  } catch {
    return baseUrl.toLowerCase().includes('openrouter.ai') ? 'openrouter' : 'openai';
  }
}

type EmbeddingRequestInput = string | string[];

function embeddingRequestBody(
  model: string,
  input: EmbeddingRequestInput,
  dimensions: number | undefined
): { model: string; input: EmbeddingRequestInput; dimensions?: number } {
  return {
    model,
    input,
    ...(dimensions ? { dimensions } : {}),
  };
}

function shouldEmbedOneInputPerRequest(config: Pick<BuildingCodeEmbeddingConfig, 'model'>): boolean {
  return isGeminiEmbedding2Model(config.model);
}

function effectiveEmbeddingDimensions(
  config: Pick<BuildingCodeEmbeddingConfig, 'model' | 'dimensions'>
): number | undefined {
  return normalizeEmbeddingDimensions(config.dimensions) ?? (
    isGeminiEmbedding2Model(config.model) ? 768 : undefined
  );
}

function normalizeEmbeddingDimensions(dimensions: number | undefined): number | undefined {
  return typeof dimensions === 'number' && Number.isFinite(dimensions) && dimensions > 0
    ? Math.round(dimensions)
    : undefined;
}

function isGeminiEmbedding2Model(model: string): boolean {
  return model.trim().toLowerCase() === 'google/gemini-embedding-2';
}

function embeddingsEndpoint(baseUrl: string | undefined): string {
  const normalized = normalizeOpenAICompatibleBaseUrl(baseUrl) || 'https://api.openai.com/v1';
  return `${normalized.replace(/\/+$/, '')}/embeddings`;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function responseContext(
  config: Pick<BuildingCodeEmbeddingConfig, 'provider' | 'model' | 'baseUrl'>,
  endpoint = embeddingsEndpoint(config.baseUrl)
): EmbeddingResponseContext {
  return {
    provider: config.provider || 'openai',
    model: config.model,
    endpoint: endpointLabel(endpoint),
  };
}

function endpointLabel(endpoint: string | undefined): string | undefined {
  if (!endpoint) {
    return undefined;
  }

  try {
    const parsed = new URL(endpoint);
    return `${parsed.hostname}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return endpoint.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

function compatibilityMessage(response: unknown, context: EmbeddingResponseContext): string {
  if (context.provider === 'openrouter') {
    return [
      'OpenRouter embeddings response did not include data[].embedding',
      contextParts(context, [
        `top-level keys: ${objectKeys(response)}`,
        `data[0] keys: ${firstDataItemKeys(response)}`,
      ]),
    ].filter(Boolean).join(' ');
  }

  return [
    'Embedding provider returned an unexpected embeddings response; expected data[].embedding.',
    contextParts(context),
  ].filter(Boolean).join(' ');
}

function httpEmbeddingError(
  status: number,
  body: unknown,
  context: EmbeddingResponseContext,
  redactedValues: string[] = []
): string {
  const providerName = context.provider === 'openrouter' ? 'OpenRouter' : 'Embedding provider';
  return `${providerName} embeddings request failed with HTTP ${status} ${contextParts(context, errorContextParts(body, redactedValues))}: ${bodySummary(body, context, redactedValues)}`;
}

function responseErrorBodyMessage(
  body: unknown,
  context: EmbeddingResponseContext,
  redactedValues: string[] = []
): string {
  const providerName = context.provider === 'openrouter' ? 'OpenRouter' : 'Embedding provider';
  return `${providerName} embeddings request failed ${contextParts(context, errorContextParts(body, redactedValues))}: ${bodySummary(body, context, redactedValues)}`;
}

function contextParts(context: EmbeddingResponseContext, extra: string[] = []): string {
  const parts = [
    context.provider ? `provider=${context.provider}` : '',
    context.model ? `model=${context.model}` : '',
    context.endpoint ? `endpoint=${context.endpoint}` : '',
    ...extra,
  ].filter(Boolean);

  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}

function objectKeys(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return 'none';
  }

  const keys = Object.keys(value);
  return keys.length > 0 ? keys.join(', ') : 'none';
}

function firstDataItemKeys(value: unknown): string {
  if (!value || typeof value !== 'object' || !('data' in value)) {
    return 'none';
  }

  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== 'object') {
    return 'none';
  }

  const keys = Object.keys(data[0]);
  return keys.length > 0 ? keys.join(', ') : 'none';
}

function hasResponseErrorBody(body: unknown): boolean {
  return Boolean(body && typeof body === 'object' && 'error' in body);
}

function errorContextParts(body: unknown, redactedValues: string[] = []): string[] {
  const code = extractErrorCode(body);

  return code !== undefined ? [`code=${sanitizeSummary(String(code), redactedValues)}`] : [];
}

function bodySummary(
  body: unknown,
  context: EmbeddingResponseContext,
  redactedValues: string[] = []
): string {
  const errorMessage = extractErrorMessage(body);

  if (errorMessage) {
    return sanitizeSummary(errorMessage, redactedValues);
  }

  if (hasResponseErrorBody(body)) {
    return context.provider === 'openrouter'
      ? 'OpenRouter returned an error body without a message'
      : 'Embedding provider returned an error body without a message';
  }

  if (typeof body === 'string') {
    return sanitizeSummary(body || 'No response body', redactedValues);
  }

  return 'No response body';
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const record = body as { error?: unknown; message?: unknown };
  if (typeof record.message === 'string') {
    return record.message;
  }
  if (record.error && typeof record.error === 'object') {
    const error = record.error as { message?: unknown; code?: unknown };
    if (typeof error.message === 'string') {
      return error.message;
    }
    if (typeof error.code === 'string' || typeof error.code === 'number') {
      return String(error.code);
    }
  }
  if (typeof record.error === 'string') {
    return record.error;
  }

  return undefined;
}

function extractErrorCode(body: unknown): string | number | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const record = body as { error?: unknown; code?: unknown };
  if (typeof record.code === 'string' || typeof record.code === 'number') {
    return record.code;
  }
  if (record.error && typeof record.error === 'object') {
    const error = record.error as { code?: unknown };
    if (typeof error.code === 'string' || typeof error.code === 'number') {
      return error.code;
    }
  }

  return undefined;
}

function sanitizeSummary(value: string, redactedValues: string[] = []): string {
  let sanitized = value
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-key]')
    .trim();

  sanitized = redactValues(sanitized, redactedValues);
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  sanitized = redactValues(sanitized, redactedValues);

  return sanitized.slice(0, 500);
}

function redactValues(value: string, redactedValues: string[]): string {
  let redacted = value;

  for (const redactedValue of redactedValues) {
    if (!redactedValue) {
      continue;
    }

    for (const variant of redactionVariants(redactedValue)) {
      redacted = redacted.split(variant).join('[redacted-input]');
    }
  }

  return redacted;
}

function redactionVariants(value: string): string[] {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const escaped = JSON.stringify(value).slice(1, -1);
  return Array.from(new Set([value, normalized, escaped].filter(Boolean)));
}
