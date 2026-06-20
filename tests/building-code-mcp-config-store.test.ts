import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    private store: Record<string, unknown>;

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options.defaults || {}) };
    }

    get<K extends keyof T>(key: K, fallback?: T[K]): T[K] {
      return (this.store[key as string] ?? fallback) as T[K];
    }

    set(key: string, value: unknown): void {
      this.store[key] = value;
    }
  }

  return { default: MockStore };
});

import type { AppConfig } from '../src/main/config/config-store';
import {
  MCP_SERVER_PRESETS,
  mcpConfigStore,
  resolveBuildingCodeRuntimeEnv,
} from '../src/main/mcp/mcp-config-store';

function makeOpenAIEmbeddingConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    provider: 'custom',
    customProtocol: 'openai',
    apiKey: 'sk-active',
    baseUrl: 'https://active.example.test/v1',
    model: 'chat-model',
    activeProfileKey: 'custom:openai',
    profiles: {},
    activeConfigSetId: 'default',
    configSets: [],
    claudeCodePath: '',
    defaultWorkdir: '',
    globalSkillsPath: '',
    enableDevLogs: false,
    theme: 'light',
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: {
        inheritFromActive: true,
        apiKey: '',
        baseUrl: '',
        model: '',
        timeoutMs: 180000,
      },
      embedding: {
        inheritFromActive: false,
        provider: 'custom',
        customProtocol: 'openai',
        apiKey: 'sk-memory-embedding',
        baseUrl: 'https://embedding.example.test/v1',
        model: 'embedding-model',
        timeoutMs: 12000,
      },
      useEmbedding: true,
      maxNavSteps: 2,
      ingestionConcurrency: 4,
      storageRoot: '',
      evalEnabled: false,
      evalWorkspaces: [],
      evalMaxRounds: 12,
      evalArtifactsRoot: '',
      promptIterationRounds: 2,
    },
    enableThinking: false,
    isConfigured: true,
    ...overrides,
  };
}

describe('building-code MCP config preset', () => {
  it('defines and resolves the bundled Building_Code server path placeholder', () => {
    expect(MCP_SERVER_PRESETS['building-code']).toMatchObject({
      name: 'Building_Code',
      command: 'node',
      args: ['{BUILDING_CODE_SERVER_PATH}'],
    });

    const config = mcpConfigStore.createFromPreset('building-code', true);

    expect(config?.enabled).toBe(true);
    expect(config?.name).toBe('Building_Code');
    expect(config?.args?.[0]).toMatch(/building-code-server\.(js|ts)$/);
    expect(config?.args?.[0]).not.toBe('{BUILDING_CODE_SERVER_PATH}');
  });

  it('inherits OpenAI-compatible memory embedding settings for Building_Code runtime env', () => {
    const env = resolveBuildingCodeRuntimeEnv({}, makeOpenAIEmbeddingConfig());

    expect(env).toMatchObject({
      BUILDING_CODE_INDEX_DIR: path.join('/tmp', 'knowledge-base', 'building-code', 'index'),
      BUILDING_CODE_EMBEDDING_API_KEY: 'sk-memory-embedding',
      BUILDING_CODE_EMBEDDING_BASE_URL: 'https://embedding.example.test/v1',
      BUILDING_CODE_EMBEDDING_MODEL: 'embedding-model',
      BUILDING_CODE_EMBEDDING_TIMEOUT_MS: '12000',
    });
  });

  it('keeps explicit Building_Code embedding env over inherited memory settings', () => {
    const env = resolveBuildingCodeRuntimeEnv(
      {
        BUILDING_CODE_INDEX_DIR: '/manual/index',
        BUILDING_CODE_EMBEDDING_API_KEY: 'sk-manual',
        BUILDING_CODE_EMBEDDING_BASE_URL: 'https://manual.example.test/v1',
        BUILDING_CODE_EMBEDDING_MODEL: 'manual-model',
      },
      makeOpenAIEmbeddingConfig()
    );

    expect(env).toMatchObject({
      BUILDING_CODE_INDEX_DIR: '/manual/index',
      BUILDING_CODE_EMBEDDING_API_KEY: 'sk-manual',
      BUILDING_CODE_EMBEDDING_BASE_URL: 'https://manual.example.test/v1',
      BUILDING_CODE_EMBEDDING_MODEL: 'manual-model',
      BUILDING_CODE_EMBEDDING_TIMEOUT_MS: '12000',
    });
  });
});
