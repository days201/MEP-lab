import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/main/config/config-store';
import {
  hasUsableEmbeddingConfig,
  resolveEmbeddingRuntimeConfig,
} from '../src/main/config/embedding-runtime-config';

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    provider: 'openai',
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4',
    activeProfileKey: 'openai',
    profiles: {},
    activeConfigSetId: 'default',
    configSets: [
      {
        id: 'default',
        name: 'Default',
        provider: 'openai',
        customProtocol: 'openai',
        activeProfileKey: 'openai',
        profiles: {},
        enableThinking: false,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    enableDevLogs: false,
    theme: 'light',
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: { mode: 'use-agent-model' },
      useEmbedding: false,
      maxNavSteps: 2,
      ingestionConcurrency: 4,
    },
    enableThinking: false,
    isConfigured: true,
    ...overrides,
  };
}

describe('embedding runtime config', () => {
  it('resolves shared embedding from active config set', () => {
    const config = baseConfig({
      configSets: [
        {
          id: 'default',
          name: 'Default',
          provider: 'openai',
          customProtocol: 'openai',
          activeProfileKey: 'openai',
          profiles: {},
          embedding: {
            enabled: true,
            provider: 'openai',
            modelId: 'text-embedding-3-small',
            apiKey: 'sk-embed',
            baseUrl: 'https://api.openai.com/v1',
          },
          enableThinking: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const resolved = resolveEmbeddingRuntimeConfig(config);
    expect(resolved?.model).toBe('text-embedding-3-small');
    expect(resolved?.apiKey).toBe('sk-embed');
    expect(hasUsableEmbeddingConfig(config)).toBe(true);
  });

  it('resolves OpenRouter Gemini embedding settings from the active config set', () => {
    const config = baseConfig({
      provider: 'openrouter',
      apiKey: 'sk-agent',
      baseUrl: 'https://openrouter.ai/api/v1',
      activeProfileKey: 'openrouter',
      configSets: [
        {
          id: 'default',
          name: 'Default',
          provider: 'openrouter',
          customProtocol: 'openai',
          activeProfileKey: 'openrouter',
          profiles: {},
          embedding: {
            enabled: true,
            provider: 'openrouter',
            modelId: 'google/gemini-embedding-2',
            apiKey: 'sk-or-v1-embed',
            baseUrl: 'https://openrouter.ai/api/v1',
          },
          enableThinking: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(resolveEmbeddingRuntimeConfig(config)).toMatchObject({
      provider: 'openrouter',
      customProtocol: 'openai',
      apiKey: 'sk-or-v1-embed',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-embedding-2',
      dimensions: 768,
    });
    expect(hasUsableEmbeddingConfig(config)).toBe(true);
  });

  it('does not force dimensions for non-Gemini embedding settings', () => {
    const config = baseConfig({
      configSets: [
        {
          id: 'default',
          name: 'Default',
          provider: 'openai',
          customProtocol: 'openai',
          activeProfileKey: 'openai',
          profiles: {},
          embedding: {
            enabled: true,
            provider: 'openai',
            modelId: 'text-embedding-3-small',
            apiKey: 'sk-embed',
            baseUrl: 'https://api.openai.com/v1',
          },
          enableThinking: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(resolveEmbeddingRuntimeConfig(config)).not.toHaveProperty('dimensions');
  });

  it('preserves explicitly configured dimensions for OpenAI-compatible embedding settings', () => {
    const config = baseConfig({
      configSets: [
        {
          id: 'default',
          name: 'Default',
          provider: 'openai',
          customProtocol: 'openai',
          activeProfileKey: 'openai',
          profiles: {},
          embedding: {
            enabled: true,
            provider: 'openai',
            modelId: 'text-embedding-3-small',
            dimensions: 512,
            apiKey: 'sk-embed',
            baseUrl: 'https://api.openai.com/v1',
          },
          enableThinking: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(resolveEmbeddingRuntimeConfig(config)?.dimensions).toBe(512);
  });

  it('migrates legacy memoryRuntime.embedding as fallback', () => {
    const config = baseConfig({
      memoryRuntime: {
        llm: { mode: 'use-agent-model' },
        embedding: {
          inheritFromActive: false,
          provider: 'custom',
          customProtocol: 'openai',
          apiKey: 'sk-legacy',
          baseUrl: 'https://embedding.example.test/v1',
          model: 'legacy-embed',
          timeoutMs: 12000,
        },
        useEmbedding: true,
        maxNavSteps: 2,
        ingestionConcurrency: 4,
      },
    });

    const resolved = resolveEmbeddingRuntimeConfig(config);
    expect(resolved?.model).toBe('legacy-embed');
    expect(resolved?.apiKey).toBe('sk-legacy');
  });
});
