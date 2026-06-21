import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { hasUsableEmbeddingConfigClient } from '../../shared/embedding-config-status';

const DISMISS_KEY = 'mep-lab-embedding-config-warning-dismissed';
const supportsStorage = typeof window !== 'undefined' && window.localStorage;

interface ApiConfigBannerProps {
  context?: 'chat' | 'knowledgeBase';
}

export function ApiConfigBanner({ context = 'chat' }: ApiConfigBannerProps) {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const setSettingsSection = useAppStore((s) => s.setSettingsSection);
  const [dismissed, setDismissed] = useState(() =>
    supportsStorage ? localStorage.getItem(DISMISS_KEY) === 'true' : false
  );
  const [dismissSignature, setDismissSignature] = useState('');

  const configSignature = JSON.stringify({
    embedding: appConfig?.configSets?.find((set) => set.id === appConfig.activeConfigSetId)
      ?.embedding,
    legacy: appConfig?.memoryRuntime?.embedding,
    apiKey: appConfig?.apiKey ? 'set' : '',
  });

  const hasEmbedding = hasUsableEmbeddingConfigClient(appConfig);
  const visible = !hasEmbedding && (!dismissed || dismissSignature !== configSignature);

  useEffect(() => {
    if (hasEmbedding && supportsStorage) {
      localStorage.removeItem(DISMISS_KEY);
      setDismissed(false);
    }
  }, [hasEmbedding]);

  if (!visible) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    setDismissSignature(configSignature);
    if (supportsStorage) {
      localStorage.setItem(DISMISS_KEY, 'true');
    }
  };

  const openEmbeddings = () => {
    setSettingsSection('embeddings');
    setSettingsTab('api');
    setShowSettings(true);
  };

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm ${
        context === 'knowledgeBase' ? 'mb-4' : 'mx-4 mb-3'
      }`}
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-text-primary">{t('api.embeddingWarning')}</p>
        <button
          type="button"
          onClick={openEmbeddings}
          className="text-accent hover:underline font-medium"
        >
          {t('api.configureEmbeddings')}
        </button>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded-md p-1 text-text-muted hover:bg-background/60 hover:text-text-primary"
        aria-label={t('common.dismiss')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
