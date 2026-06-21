import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/renderer/types';
import {
  getSemanticSearchDisplayStatus,
  hasUsableEmbeddingConfigClient,
} from '../src/shared/embedding-config-status';

const baseConfig = {
  provider: 'openai',
  apiKey: 'sk-test',
  model: 'gpt-4o',
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
      embedding: {
        enabled: true,
        provider: 'openai',
        customProtocol: 'openai',
        apiKey: 'sk-embed',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'text-embedding-3-small',
      },
    },
  ],
} as AppConfig;

describe('embedding-config-status', () => {
  it('detects usable embedding configuration', () => {
    expect(hasUsableEmbeddingConfigClient(baseConfig)).toBe(true);
  });

  it('distinguishes active semantic search from pending rebuild', () => {
    expect(
      getSemanticSearchDisplayStatus(baseConfig, {
        semanticSearchAvailable: true,
        chunkCount: 3,
      })
    ).toBe('active');

    expect(
      getSemanticSearchDisplayStatus(baseConfig, {
        semanticSearchAvailable: false,
        chunkCount: 3,
      })
    ).toBe('pending_rebuild');

    expect(
      getSemanticSearchDisplayStatus(baseConfig, {
        semanticSearchAvailable: false,
        chunkCount: 0,
      })
    ).toBe('ready_no_content');
  });
});
