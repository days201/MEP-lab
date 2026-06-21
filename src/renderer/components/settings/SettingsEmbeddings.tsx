import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppConfig, EmbeddingRuntimeConfig, ProviderType } from '../../types';
import { useAppStore } from '../../store';
import { DEFAULT_OLLAMA_BASE_URL } from '../../../shared/ollama-base-url';

const EMBEDDING_PROVIDERS: ProviderType[] = ['openai', 'openrouter', 'ollama', 'custom'];

const defaultEmbedding = (): EmbeddingRuntimeConfig => ({
  enabled: false,
  provider: 'openai',
  customProtocol: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  modelId: 'text-embedding-3-small',
  timeoutMs: 180000,
});

function readEmbeddingFromConfig(config: AppConfig | null): EmbeddingRuntimeConfig {
  const activeSet =
    config?.configSets?.find((set) => set.id === config.activeConfigSetId) || config?.configSets?.[0];
  if (activeSet?.embedding) {
    return { ...defaultEmbedding(), ...activeSet.embedding };
  }
  const legacy = config?.memoryRuntime?.embedding;
  if (legacy?.inheritFromActive) {
    return {
      enabled: config?.memoryRuntime?.useEmbedding ?? false,
      provider: config?.provider || 'openai',
      customProtocol: config?.customProtocol || 'openai',
      apiKey: '',
      baseUrl: config?.baseUrl,
      modelId: legacy.model?.trim() || 'text-embedding-3-small',
      timeoutMs: legacy.timeoutMs,
    };
  }
  if (legacy?.provider) {
    return {
      enabled: true,
      provider: legacy.provider,
      customProtocol: legacy.customProtocol || 'openai',
      apiKey: legacy.apiKey || '',
      baseUrl: legacy.baseUrl,
      modelId: legacy.model?.trim() || 'text-embedding-3-small',
      timeoutMs: legacy.timeoutMs,
    };
  }
  return defaultEmbedding();
}

export function SettingsEmbeddings() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [draft, setDraft] = useState<EmbeddingRuntimeConfig>(() => readEmbeddingFromConfig(appConfig));
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(readEmbeddingFromConfig(appConfig));
  }, [appConfig]);

  const saveEmbedding = useCallback(async () => {
    if (!appConfig) return;
    setIsSaving(true);
    setError('');
    setSuccess(false);
    try {
      const nextSets = (appConfig.configSets || []).map((set) =>
        set.id === appConfig.activeConfigSetId ? { ...set, embedding: draft } : set
      );
      const result = await window.electronAPI.config.save({
        configSets: nextSets,
        memoryRuntime: {
          llm: appConfig.memoryRuntime?.llm || { mode: 'use-agent-model' },
          useEmbedding: draft.enabled,
          maxNavSteps: appConfig.memoryRuntime?.maxNavSteps ?? 2,
          ingestionConcurrency: appConfig.memoryRuntime?.ingestionConcurrency ?? 4,
          storageRoot: appConfig.memoryRuntime?.storageRoot,
          evalEnabled: appConfig.memoryRuntime?.evalEnabled,
          evalWorkspaces: appConfig.memoryRuntime?.evalWorkspaces,
          evalMaxRounds: appConfig.memoryRuntime?.evalMaxRounds,
          evalArtifactsRoot: appConfig.memoryRuntime?.evalArtifactsRoot,
          promptIterationRounds: appConfig.memoryRuntime?.promptIterationRounds,
        },
      });
      if (result.success && result.config) {
        setAppConfig(result.config);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2000);
        if (draft.enabled) {
          try {
            const overview = await window.electronAPI.knowledgeBase.getOverview();
            if (overview.summary.chunkCount > 0 && !overview.summary.semanticSearchAvailable) {
              await window.electronAPI.knowledgeBase.rebuildEmbeddings();
            }
          } catch {
            // KB may be empty or embeddings may fail until documents exist; user can rebuild manually.
          }
        }
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  }, [appConfig, draft, setAppConfig]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Sparkles className="h-4 w-4" />
          {t('api.embeddingsTitle')}
        </label>
        <p className="text-xs leading-5 text-text-muted">{t('api.embeddingsDescription')}</p>
      </div>

      <label className="flex items-start gap-2 text-sm text-text-primary">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
          className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-accent"
        />
        <span>{t('api.embeddingsEnabled')}</span>
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            {t('api.provider')}
          </label>
          <select
            value={draft.provider}
            onChange={(e) => {
              const provider = e.target.value as ProviderType;
              setDraft((prev) => ({
                ...prev,
                provider,
                customProtocol: provider === 'custom' ? 'openai' : prev.customProtocol,
                baseUrl:
                  provider === 'ollama'
                    ? DEFAULT_OLLAMA_BASE_URL
                    : provider === 'openai'
                      ? 'https://api.openai.com/v1'
                      : prev.baseUrl,
              }));
            }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
          >
            {EMBEDDING_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p === 'custom' ? t('api.custom') : p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            {t('api.embeddingModelId')}
          </label>
          <input
            value={draft.modelId}
            onChange={(e) => setDraft((prev) => ({ ...prev, modelId: e.target.value }))}
            placeholder="text-embedding-3-small"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            {t('api.apiKey')}
          </label>
          <input
            type="password"
            value={draft.apiKey || ''}
            onChange={(e) => setDraft((prev) => ({ ...prev, apiKey: e.target.value }))}
            placeholder={t('api.embeddingKeyInheritHint')}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            {t('api.baseUrl')}
          </label>
          <input
            value={draft.baseUrl || ''}
            onChange={(e) => setDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
          />
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {success && (
        <div className="flex items-center gap-2 text-sm text-success">
          <CheckCircle className="h-4 w-4" />
          {t('common.saved')}
        </div>
      )}

      <button
        type="button"
        onClick={() => void saveEmbedding()}
        disabled={isSaving}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {t('api.saveEmbeddings')}
      </button>
    </div>
  );
}
