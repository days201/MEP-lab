import type {
  AppConfig,
  CustomProtocolType,
  EmbeddingRuntimeConfig,
  MemoryModelRuntimeConfig,
  ProviderType,
} from './config-store';
import { configStore } from './config-store';
import {
  normalizeOpenAICompatibleBaseUrl,
  resolveOllamaCredentials,
  resolveOpenAICredentials,
  shouldAllowEmptyOllamaApiKey,
} from './auth-utils';

export interface ResolvedEmbeddingConfig {
  provider: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey: string;
  baseUrl?: string;
  model: string;
  dimensions?: number;
  timeoutMs: number;
}

function isOpenAICompatibleProvider(
  provider: ProviderType,
  protocol?: CustomProtocolType
): boolean {
  return (
    provider === 'openai' ||
    provider === 'openrouter' ||
    provider === 'ollama' ||
    (provider === 'custom' && protocol === 'openai')
  );
}

function getActiveConfigSet(config: AppConfig) {
  return (
    config.configSets?.find((set) => set.id === config.activeConfigSetId) || config.configSets?.[0]
  );
}

function legacyToEmbeddingConfig(
  config: AppConfig,
  legacy: MemoryModelRuntimeConfig
): EmbeddingRuntimeConfig | null {
  if (legacy.inheritFromActive) {
    return {
      enabled: true,
      provider: config.provider,
      customProtocol: config.customProtocol,
      apiKey: '',
      baseUrl: '',
      modelId: legacy.model?.trim() || 'text-embedding-3-small',
      timeoutMs: legacy.timeoutMs,
    };
  }

  if (!legacy.provider) {
    return null;
  }

  return {
    enabled: true,
    provider: legacy.provider,
    customProtocol: legacy.customProtocol,
    apiKey: legacy.apiKey || '',
    baseUrl: legacy.baseUrl,
    modelId: legacy.model?.trim() || 'text-embedding-3-small',
    timeoutMs: legacy.timeoutMs,
  };
}

function resolveEmbeddingSource(config: AppConfig): EmbeddingRuntimeConfig | null {
  const activeSet = getActiveConfigSet(config);
  if (activeSet?.embedding) {
    return activeSet.embedding;
  }

  const legacy = config.memoryRuntime?.embedding;
  if (legacy) {
    return legacyToEmbeddingConfig(config, legacy);
  }

  return null;
}

function inheritAgentCredentials(
  config: AppConfig,
  source: EmbeddingRuntimeConfig
): EmbeddingRuntimeConfig {
  const hasOwnKey = Boolean(source.apiKey?.trim());
  const hasOwnBaseUrl = Boolean(source.baseUrl?.trim());
  if (hasOwnKey || hasOwnBaseUrl) {
    return source;
  }
  return {
    ...source,
    provider: source.provider || config.provider,
    customProtocol: source.customProtocol || config.customProtocol,
    apiKey: config.apiKey || '',
    baseUrl: config.baseUrl,
  };
}

export function resolveEmbeddingRuntimeConfig(
  appConfig: AppConfig = configStore.getAll()
): ResolvedEmbeddingConfig | null {
  const rawSource = resolveEmbeddingSource(appConfig);
  if (!rawSource?.enabled) {
    return null;
  }

  const source = inheritAgentCredentials(appConfig, rawSource);
  const provider = source.provider;
  const protocol: CustomProtocolType =
    source.customProtocol ||
    (provider === 'openai' || provider === 'openrouter' || provider === 'ollama'
      ? 'openai'
      : provider === 'gemini'
        ? 'gemini'
        : 'anthropic');

  if (!isOpenAICompatibleProvider(provider, protocol)) {
    return null;
  }

  const apiKey = source.apiKey?.trim() || '';
  const baseUrl = source.baseUrl?.trim();

  const credentials =
    provider === 'ollama'
      ? resolveOllamaCredentials({ provider, customProtocol: protocol, apiKey, baseUrl })
      : resolveOpenAICredentials({ provider, customProtocol: protocol, apiKey, baseUrl });

  const resolvedApiKey = credentials?.apiKey?.trim() || apiKey;
  const resolvedBaseUrl =
    credentials?.baseUrl || normalizeOpenAICompatibleBaseUrl(baseUrl) || baseUrl;

  if (
    !resolvedApiKey &&
    !shouldAllowEmptyOllamaApiKey({
      provider,
      customProtocol: protocol,
      baseUrl: resolvedBaseUrl,
    })
  ) {
    return null;
  }

  const model = (source.modelId || 'text-embedding-3-small').trim();
  if (!model) {
    return null;
  }

  const dimensions = resolveEmbeddingDimensions(source.dimensions, model);

  return {
    provider,
    customProtocol: protocol,
    apiKey: resolvedApiKey,
    baseUrl: resolvedBaseUrl,
    model,
    ...(dimensions ? { dimensions } : {}),
    timeoutMs: Math.max(5_000, source.timeoutMs ?? 180_000),
  };
}

export function hasUsableEmbeddingConfig(appConfig: AppConfig = configStore.getAll()): boolean {
  return resolveEmbeddingRuntimeConfig(appConfig) !== null;
}

function resolveEmbeddingDimensions(dimensions: number | undefined, model: string): number | undefined {
  if (typeof dimensions === 'number' && Number.isFinite(dimensions) && dimensions > 0) {
    return Math.round(dimensions);
  }

  return model.trim().toLowerCase() === 'google/gemini-embedding-2' ? 768 : undefined;
}
