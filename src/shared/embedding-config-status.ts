import type { AppConfig, EmbeddingRuntimeConfig } from '../renderer/types';

function resolveEmbeddingSource(config: AppConfig): EmbeddingRuntimeConfig | null {
  const activeSet =
    config.configSets?.find((set) => set.id === config.activeConfigSetId) || config.configSets?.[0];
  if (activeSet?.embedding) {
    return activeSet.embedding;
  }

  const legacy = config.memoryRuntime?.embedding;
  if (!legacy) {
    return null;
  }

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
    apiKey: legacy.apiKey,
    baseUrl: legacy.baseUrl,
    modelId: legacy.model?.trim() || 'text-embedding-3-small',
    timeoutMs: legacy.timeoutMs,
  };
}

export function hasUsableEmbeddingConfigClient(config: AppConfig | null | undefined): boolean {
  if (!config) {
    return false;
  }

  const source = resolveEmbeddingSource(config);
  if (!source?.enabled || !source.modelId?.trim()) {
    return false;
  }

  const provider = source.provider;
  const isOllama = provider === 'ollama';
  const apiKey = (source.apiKey?.trim() || config.apiKey?.trim() || '').length > 0;

  if (isOllama) {
    return true;
  }

  return apiKey;
}

export type SemanticSearchDisplayStatus =
  | 'active'
  | 'pending_rebuild'
  | 'ready_no_content'
  | 'not_configured';

export function getSemanticSearchDisplayStatus(
  config: AppConfig | null | undefined,
  summary: { semanticSearchAvailable: boolean; chunkCount: number } | null | undefined
): SemanticSearchDisplayStatus {
  if (summary?.semanticSearchAvailable) {
    return 'active';
  }
  if (!hasUsableEmbeddingConfigClient(config)) {
    return 'not_configured';
  }
  if ((summary?.chunkCount ?? 0) > 0) {
    return 'pending_rebuild';
  }
  return 'ready_no_content';
}
