import type {
  AppConfig,
  CustomProtocolType,
  MemoryLlmMode,
  MemoryModelRuntimeConfig,
  ProviderType,
} from '../config/config-store';

export interface ResolvedMemoryModelConfig {
  provider: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeoutMs: number;
}

function isMemoryLlmMode(value: unknown): value is MemoryLlmMode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mode' in value &&
    ((value as MemoryLlmMode).mode === 'disabled' ||
      (value as MemoryLlmMode).mode === 'use-agent-model' ||
      (value as MemoryLlmMode).mode === 'use-specific-agent-model')
  );
}

function isLegacyMemoryModelConfig(value: unknown): value is MemoryModelRuntimeConfig {
  return typeof value === 'object' && value !== null && 'inheritFromActive' in value;
}

export function resolveMemoryModelRuntimeConfig(
  appConfig: AppConfig,
  input: MemoryModelRuntimeConfig | undefined,
  fallbackModel: string
): ResolvedMemoryModelConfig {
  const inherit = input?.inheritFromActive !== false;
  const activeProvider = appConfig.provider;
  const activeProtocol = appConfig.customProtocol;
  const activeBaseUrl = appConfig.baseUrl;
  const activeApiKey = appConfig.apiKey;
  const activeModel = appConfig.model;

  const provider = inherit ? activeProvider : input?.provider || activeProvider;
  const customProtocol = inherit ? activeProtocol : input?.customProtocol || activeProtocol;
  const apiKey = inherit ? activeApiKey : input?.apiKey || '';
  const baseUrl = inherit ? activeBaseUrl : input?.baseUrl || activeBaseUrl;
  const model = (input?.model || (inherit ? activeModel : '') || fallbackModel).trim();
  const timeoutMs = Math.max(5_000, input?.timeoutMs || 180_000);

  return {
    provider,
    customProtocol,
    apiKey,
    baseUrl,
    model,
    timeoutMs,
  };
}

function resolveModelFromAgentProfile(
  appConfig: AppConfig,
  modelId: string | undefined
): string {
  const trimmed = modelId?.trim();
  if (trimmed) {
    return trimmed;
  }
  return appConfig.model;
}

export function resolveMemoryLlmRuntimeConfig(
  appConfig: AppConfig
): ResolvedMemoryModelConfig | null {
  const llm = appConfig.memoryRuntime?.llm;

  if (isLegacyMemoryModelConfig(llm)) {
    return resolveMemoryModelRuntimeConfig(appConfig, llm, appConfig.model);
  }

  if (isMemoryLlmMode(llm)) {
    if (llm.mode === 'disabled') {
      return null;
    }
    if (llm.mode === 'use-specific-agent-model') {
      const model = resolveModelFromAgentProfile(appConfig, llm.selectedModelId);
      return {
        provider: appConfig.provider,
        customProtocol: appConfig.customProtocol,
        apiKey: appConfig.apiKey,
        baseUrl: appConfig.baseUrl,
        model,
        timeoutMs: 180_000,
      };
    }
    return {
      provider: appConfig.provider,
      customProtocol: appConfig.customProtocol,
      apiKey: appConfig.apiKey,
      baseUrl: appConfig.baseUrl,
      model: appConfig.model,
      timeoutMs: 180_000,
    };
  }

  return {
    provider: appConfig.provider,
    customProtocol: appConfig.customProtocol,
    apiKey: appConfig.apiKey,
    baseUrl: appConfig.baseUrl,
    model: appConfig.model,
    timeoutMs: 180_000,
  };
}
