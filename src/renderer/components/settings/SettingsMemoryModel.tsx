import { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, CheckCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppConfig, AgentModelConfig, MemoryLlmMode } from '../../types';
import { useAppStore } from '../../store';

function readMemoryLlmMode(config: AppConfig | null): MemoryLlmMode {
  const llm = config?.memoryRuntime?.llm;
  if (llm && 'mode' in llm) {
    return llm;
  }
  return { mode: 'use-agent-model' };
}

function listAgentModels(config: AppConfig | null): AgentModelConfig[] {
  if (!config) return [];
  const profile = config.profiles?.[config.activeProfileKey];
  if (profile?.models?.length) return profile.models;
  if (profile?.model?.trim()) return [{ id: profile.model.trim() }];
  return [];
}

export function SettingsMemoryModel() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [mode, setMode] = useState<MemoryLlmMode>(() => readMemoryLlmMode(appConfig));
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setMode(readMemoryLlmMode(appConfig));
  }, [appConfig]);

  const agentModels = listAgentModels(appConfig);

  const saveMode = useCallback(async () => {
    if (!appConfig) return;
    setIsSaving(true);
    try {
      const result = await window.electronAPI.config.save({
        memoryRuntime: {
          ...appConfig.memoryRuntime,
          llm: mode,
          useEmbedding: appConfig.memoryRuntime?.useEmbedding ?? false,
          maxNavSteps: appConfig.memoryRuntime?.maxNavSteps ?? 2,
          ingestionConcurrency: appConfig.memoryRuntime?.ingestionConcurrency ?? 4,
        },
      });
      if (result.success && result.config) {
        setAppConfig(result.config);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2000);
      }
    } finally {
      setIsSaving(false);
    }
  }, [appConfig, mode, setAppConfig]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <BrainCircuit className="h-4 w-4" />
          {t('api.memoryModelTitle')}
        </label>
        <p className="text-xs leading-5 text-text-muted">{t('api.memoryModelDescription')}</p>
      </div>

      <div className="space-y-3">
        {(
          [
            ['disabled', t('api.memoryModelDisabled')],
            ['use-agent-model', t('api.memoryModelUseAgent')],
            ['use-specific-agent-model', t('api.memoryModelPickAgent')],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="radio"
              name="memory-llm-mode"
              checked={mode.mode === value}
              onChange={() =>
                setMode((prev) => ({
                  ...prev,
                  mode: value,
                  selectedModelId:
                    value === 'use-specific-agent-model'
                      ? prev.selectedModelId || agentModels[0]?.id
                      : undefined,
                }))
              }
            />
            {label}
          </label>
        ))}
      </div>

      {mode.mode === 'use-specific-agent-model' && (
        <select
          value={mode.selectedModelId || agentModels[0]?.id || ''}
          onChange={(e) =>
            setMode((prev) => ({ ...prev, selectedModelId: e.target.value }))
          }
          className="w-full max-w-md rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
        >
          {agentModels.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label || entry.id}
            </option>
          ))}
        </select>
      )}

      {success && (
        <div className="flex items-center gap-2 text-sm text-success">
          <CheckCircle className="h-4 w-4" />
          {t('common.saved')}
        </div>
      )}

      <button
        type="button"
        onClick={() => void saveMode()}
        disabled={isSaving}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {t('api.saveMemoryModel')}
      </button>
    </div>
  );
}
