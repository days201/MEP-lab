import { useCallback, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentModelConfig, AppConfig } from '../types';

interface ComposerModelSelectorProps {
  appConfig: AppConfig | null;
  value?: string;
  disabled?: boolean;
  onSelect: (modelId: string) => void;
}

function listAgentModels(appConfig: AppConfig | null): AgentModelConfig[] {
  if (!appConfig) {
    return [];
  }
  const profile = appConfig.profiles?.[appConfig.activeProfileKey];
  if (!profile) {
    return [];
  }
  if (profile.models && profile.models.length > 0) {
    return profile.models;
  }
  if (profile.model?.trim()) {
    return [{ id: profile.model.trim() }];
  }
  return [];
}

export function ComposerModelSelector({
  appConfig,
  value,
  disabled = false,
  onSelect,
}: ComposerModelSelectorProps) {
  const { t } = useTranslation();
  const models = useMemo(() => listAgentModels(appConfig), [appConfig]);
  const selected = value || appConfig?.model || models[0]?.id || '';

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const next = event.target.value;
      if (next) {
        onSelect(next);
      }
    },
    [onSelect]
  );

  if (models.length <= 1) {
    const label = models[0]?.label || models[0]?.id || selected || t('chat.noModel');
    return (
      <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted">
        {label}
      </span>
    );
  }

  return (
    <div className="relative hidden sm:inline-flex">
      <select
        value={selected}
        disabled={disabled}
        onChange={handleChange}
        className="appearance-none pl-2.5 pr-7 py-1 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted hover:border-border focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50 max-w-[220px] truncate"
        title={t('api.selectModel')}
      >
        {models.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label || entry.id}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
    </div>
  );
}
