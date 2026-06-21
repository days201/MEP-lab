import { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Plug,
  Shield,
  Package,
  Clock3,
  Wifi,
  AlertCircle,
  Globe,
  BrainCircuit,
  BookOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWindowSize } from '../hooks/useWindowSize';
import { RemoteControlPanel } from './RemoteControlPanel';
import { useAppStore } from '../store';
import { SettingsAPI } from './settings/SettingsAPI';
import { SettingsSandbox } from './settings/SettingsSandbox';
import { SettingsConnectors } from './settings/SettingsConnectors';
import { SettingsSkills } from './settings/SettingsSkills';
import { SettingsSchedule } from './settings/SettingsSchedule';
import { SettingsGeneral } from './settings/SettingsGeneral';
import { SettingsLogs } from './settings/SettingsLogs';
import { SettingsMemory } from './settings/SettingsMemory';
import { SettingsKnowledgeBase } from './settings/SettingsKnowledgeBase';

interface SettingsPanelProps {
  onClose: () => void;
  initialTab?:
    | 'api'
    | 'sandbox'
    | 'connectors'
    | 'skills'
    | 'memory'
    | 'knowledgeBase'
    | 'schedule'
    | 'remote'
    | 'logs'
    | 'general';
}

type TabId =
  | 'api'
  | 'sandbox'
  | 'connectors'
  | 'skills'
  | 'memory'
  | 'knowledgeBase'
  | 'schedule'
  | 'remote'
  | 'logs'
  | 'general';

const VALID_TABS = new Set<TabId>([
  'api',
  'sandbox',
  'connectors',
  'skills',
  'memory',
  'knowledgeBase',
  'schedule',
  'remote',
  'logs',
  'general',
]);

export function SettingsPanel({ onClose, initialTab = 'api' }: SettingsPanelProps) {
  const { t } = useTranslation();
  const { width } = useWindowSize();
  const compactSidebar = width < 900;
  // Read settingsTab from store at mount time so external navigation (nav-server)
  // takes effect even before this component mounts.
  const storeTab = useAppStore((s) => s.settingsTab);
  const settingsSection = useAppStore((s) => s.settingsSection);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const resolvedInitial =
    storeTab && VALID_TABS.has(storeTab as TabId) ? (storeTab as TabId) : initialTab;

  const [activeTab, setActiveTab] = useState<TabId>(resolvedInitial);
  // Track which tabs have been viewed at least once (for lazy loading)
  const [viewedTabs, setViewedTabs] = useState<Set<TabId>>(new Set([resolvedInitial]));
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVersion);
      else if (v) setAppVersion(v);
    } catch {
      /* ignore */
    }
  }, []);

  // Consume the store signal and apply tab in one effect
  useEffect(() => {
    if (storeTab && VALID_TABS.has(storeTab as TabId)) {
      setActiveTab(storeTab as TabId);
      setSettingsTab(null);
    }
  }, [storeTab, setSettingsTab]);

  // Mark tab as viewed when it becomes active
  useEffect(() => {
    if (!viewedTabs.has(activeTab)) {
      setViewedTabs((prev) => new Set([...prev, activeTab]));
    }
  }, [activeTab]);

  const categories = [
    {
      id: 'agent',
      label: t('settings.categoryAgent', 'Agent Settings'),
      tabs: [
        {
          id: 'api' as TabId,
          label: t('settings.apiSettings'),
          icon: Settings,
          description: t('settings.apiSettingsDesc'),
        },
        {
          id: 'memory' as TabId,
          label: t('settings.memory'),
          icon: BrainCircuit,
          description: t('settings.memoryDesc'),
        },
        {
          id: 'skills' as TabId,
          label: t('settings.skills'),
          icon: Package,
          description: t('settings.skillsDesc'),
        },
      ],
    },
    {
      id: 'system',
      label: t('settings.categorySystem', 'System & Sandbox'),
      tabs: [
        {
          id: 'sandbox' as TabId,
          label: t('settings.sandbox'),
          icon: Shield,
          description: t('settings.sandboxDesc'),
        },
        {
          id: 'connectors' as TabId,
          label: t('settings.connectors'),
          icon: Plug,
          description: t('settings.connectorsDesc'),
        },
        {
          id: 'remote' as TabId,
          label: t('settings.remote', 'Remote Control'),
          icon: Wifi,
          description: t('settings.remoteDesc', 'Use remotely through Feishu or other platforms'),
        },
        {
          id: 'schedule' as TabId,
          label: t('settings.schedule'),
          icon: Clock3,
          description: t('settings.scheduleDesc'),
        },
      ],
    },
    {
      id: 'resources',
      label: t('settings.categoryResources', 'Resources & Utilities'),
      tabs: [
        {
          id: 'knowledgeBase' as TabId,
          label: t('settings.knowledgeBase', 'Knowledge Base'),
          icon: BookOpen,
          description: t(
            'settings.knowledgeBaseDesc',
            'Import building-code documents for local MCP retrieval'
          ),
        },
        {
          id: 'logs' as TabId,
          label: t('settings.logs'),
          icon: AlertCircle,
          description: t('settings.logsDesc'),
        },
        {
          id: 'general' as TabId,
          label: t('settings.general'),
          icon: Globe,
          description: t('settings.generalDesc'),
        },
      ],
    },
  ];
  const activeTabMeta = categories.flatMap((c) => c.tabs).find((tab) => tab.id === activeTab);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <div
        className={`${compactSidebar ? 'w-14' : 'w-52 lg:w-60'} bg-background-secondary/88 border-r border-border flex flex-col flex-shrink-0`}
      >
        {!compactSidebar && (
          <div className="px-4 pt-5 pb-4 border-b border-border">
            <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted">
              {t('settings.title')}
            </p>
            <h2 className="mt-1 text-[1.24rem] font-semibold tracking-[-0.03em] text-text-primary">
              MEP Lab
            </h2>
            <p className="mt-1 text-[11px] leading-4 text-text-muted">{t('settings.panelDesc')}</p>
          </div>
        )}
        <div
          className={`flex-1 overflow-y-auto ${compactSidebar ? 'p-1.5 space-y-1' : 'p-3 space-y-4'}`}
        >
          {compactSidebar
            ? categories
                .flatMap((c) => c.tabs)
                .map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    title={tab.label}
                    className={`w-full flex items-center justify-center p-2.5 rounded-lg text-left transition-all active:scale-[0.98] ${
                      activeTab === tab.id
                        ? 'bg-surface-active/40 text-text-primary border-l-2 border-accent'
                        : 'hover:bg-surface-hover/60 text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <tab.icon className="w-4.5 h-4.5 flex-shrink-0" />
                  </button>
                ))
            : categories.map((category) => (
                <div key={category.id} className="space-y-1">
                  <h3 className="px-3.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                    {category.label}
                  </h3>
                  <div className="space-y-0.5 mt-1.5">
                    {category.tabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-left transition-all active:scale-[0.98] ${
                          activeTab === tab.id
                            ? 'bg-surface-active/40 text-text-primary font-medium border-l-2 border-accent'
                            : 'hover:bg-surface-hover/60 text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        <tab.icon className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-medium truncate">{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
        </div>
        <div className={`${compactSidebar ? 'p-1.5' : 'p-4'} border-t border-border`}>
          <button
            onClick={onClose}
            className={`w-full py-2 ${compactSidebar ? 'px-2' : 'px-4'} rounded-lg bg-background hover:bg-background transition-colors text-text-secondary text-sm`}
            title={compactSidebar ? t('common.close') : undefined}
          >
            {compactSidebar ? <X className="w-4 h-4 mx-auto" /> : t('common.close')}
          </button>
          {!compactSidebar && (
            <p className="text-[10px] text-text-muted text-center mt-2 select-text">
              v{appVersion}
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex items-center justify-between px-4 lg:px-8 py-4 border-b border-border flex-shrink-0 bg-background/88 backdrop-blur-sm">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
              {t('settings.title')}
            </p>
            <h3 className="mt-1 text-[1.15rem] font-semibold tracking-[-0.02em] text-text-primary">
              {activeTabMeta?.label}
            </h3>
            {activeTabMeta?.description && (
              <p className="mt-1 text-sm text-text-muted max-w-[36rem]">
                {activeTabMeta.description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 lg:px-8 lg:py-8">
          <div className="max-w-[860px] w-full min-w-0 mx-auto">
            <div className="">
              <div className={activeTab === 'api' ? '' : 'hidden'}>
                {viewedTabs.has('api') && (
                  <>
                    <SettingsAPI initialSection={settingsSection ?? undefined} />
                  </>
                )}
              </div>
              <div className={activeTab === 'sandbox' ? '' : 'hidden'}>
                {viewedTabs.has('sandbox') && <SettingsSandbox />}
              </div>
              <div className={activeTab === 'connectors' ? '' : 'hidden'}>
                {viewedTabs.has('connectors') && (
                  <SettingsConnectors isActive={activeTab === 'connectors'} />
                )}
              </div>
              <div className={activeTab === 'skills' ? '' : 'hidden'}>
                {viewedTabs.has('skills') && <SettingsSkills isActive={activeTab === 'skills'} />}
              </div>
              <div className={activeTab === 'memory' ? '' : 'hidden'}>
                {viewedTabs.has('memory') && <SettingsMemory />}
              </div>
              <div className={activeTab === 'knowledgeBase' ? '' : 'hidden'}>
                {viewedTabs.has('knowledgeBase') && (
                  <SettingsKnowledgeBase isActive={activeTab === 'knowledgeBase'} />
                )}
              </div>
              <div className={activeTab === 'schedule' ? '' : 'hidden'}>
                {viewedTabs.has('schedule') && (
                  <SettingsSchedule isActive={activeTab === 'schedule'} />
                )}
              </div>
              <div className={activeTab === 'remote' ? '' : 'hidden'}>
                {viewedTabs.has('remote') && (
                  <RemoteControlPanel isActive={activeTab === 'remote'} />
                )}
              </div>
              <div className={activeTab === 'logs' ? '' : 'hidden'}>
                {viewedTabs.has('logs') && <SettingsLogs isActive={activeTab === 'logs'} />}
              </div>
              <div className={activeTab === 'general' ? '' : 'hidden'}>
                {viewedTabs.has('general') && <SettingsGeneral />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
