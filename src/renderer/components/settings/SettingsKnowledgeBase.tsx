import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, FolderOpen, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { KnowledgeBaseDocumentRecord, KnowledgeBaseOverview } from '../../types';
import { SettingsContentSection } from './shared';
import { useAppStore } from '../../store';
import { getSemanticSearchDisplayStatus } from '../../../shared/embedding-config-status';
import { ApiConfigBanner } from '../ApiConfigBanner';
import { buildKnowledgeBaseGraphViewModel } from './knowledge-base-graph';

const activeJobStatuses = new Set(['queued', 'parsing', 'ocr', 'canonicalizing', 'embedding']);

type TranslationFn = ReturnType<typeof useTranslation>['t'];

interface SettingsKnowledgeBaseProps {
  isActive?: boolean;
}

export function SettingsKnowledgeBase({ isActive = true }: SettingsKnowledgeBaseProps) {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const setSettingsSection = useAppStore((s) => s.setSettingsSection);
  const [buildingCodeEnabled, setBuildingCodeEnabled] = useState(false);
  const [buildingCodeServerId, setBuildingCodeServerId] = useState<string | null>(null);
  const [overview, setOverview] = useState<KnowledgeBaseOverview | null>(null);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'success' | 'error' | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  function clearStatus() {
    setStatus('');
    setStatusTone(null);
  }

  function reportStatus(message: string, tone: 'success' | 'error') {
    setStatus(message);
    setStatusTone(tone);
  }

  const graphView = useMemo(
    () => buildKnowledgeBaseGraphViewModel(overview?.graph ?? null),
    [overview]
  );
  const graphNodes = graphView.nodes;
  const unresolvedReferenceEdges = useMemo(
    () => graphView.edges.filter((edge) => edge.status === 'unresolved'),
    [graphView]
  );

  const selectedNode = useMemo(
    () =>
      graphNodes.find((node) => node.nodeId === graphView.resolveNodeId(selectedNodeId ?? '')) ??
      graphNodes[0] ??
      null,
    [graphNodes, graphView, selectedNodeId]
  );

  const selectedNodeEdgeCounts = useMemo(() => {
    if (!selectedNode || !overview) {
      return { resolved: 0, unresolved: 0 };
    }
    const edges = graphView.edges.filter((edge) => edge.fromNodeId === selectedNode.nodeId);
    return {
      resolved: edges.filter((edge) => edge.status === 'resolved').length,
      unresolved: edges.filter((edge) => edge.status === 'unresolved').length,
    };
  }, [graphView, selectedNode]);

  const actionLabels = {
    reparse: t('knowledgeBase.reparseAction'),
    revealSource: t('knowledgeBase.revealSourceAction'),
    remove: t('knowledgeBase.removeAction'),
  };

  async function refresh() {
    const next = await window.electronAPI.knowledgeBase.getOverview();
    setOverview(next);
    if (!selectedNodeId && next.graph.nodes[0]) setSelectedNodeId(next.graph.nodes[0].nodeId);
  }

  const activeDocuments =
    overview?.documents.filter((document) => document.status !== 'removed') ?? [];
  const hasActiveJobs = activeDocuments.some((document) => activeJobStatuses.has(document.status));

  useEffect(() => {
    if (!isActive) return;
    void refresh().catch((error) =>
      reportStatus(error instanceof Error ? error.message : String(error), 'error')
    );
    void window.electronAPI.mcp.getServers().then((servers) => {
      const match = servers.find((server) => server.name === 'Building_Code');
      if (match) {
        setBuildingCodeServerId(match.id);
        setBuildingCodeEnabled(Boolean(match.enabled));
      }
    });
  }, [isActive]);

  useEffect(() => {
    if (!isActive || !hasActiveJobs) return;
    let cancelled = false;
    let refreshing = false;

    async function refreshOverview() {
      if (refreshing || cancelled) return;
      refreshing = true;
      try {
        const next = await window.electronAPI.knowledgeBase.getOverview();
        if (cancelled) return;
        setOverview(next);
      } catch (error) {
        if (!cancelled) {
          reportStatus(error instanceof Error ? error.message : String(error), 'error');
        }
      } finally {
        refreshing = false;
      }
    }

    const intervalId = window.setInterval(() => {
      void refreshOverview();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [hasActiveJobs, isActive]);

  useEffect(() => {
    if (!overview) return;
    const nodes = graphNodes;
    if (nodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }
    if (!selectedNodeId || !nodes.some((node) => node.nodeId === selectedNodeId)) {
      setSelectedNodeId(nodes[0].nodeId);
    }
  }, [graphNodes, selectedNodeId, overview]);

  async function pickAndUpload() {
    if (busy) return;
    setBusy(true);
    clearStatus();
    try {
      const files = await window.electronAPI.knowledgeBase.selectDocuments();
      if (files.length === 0) return;
      setOverview(await window.electronAPI.knowledgeBase.uploadDocuments(files));
      reportStatus(t('knowledgeBase.uploadQueued'), 'success');
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function uploadDropped(files: FileList | null) {
    if (busy) return;
    const paths = window.electronAPI.knowledgeBase.getDroppedFilePaths(Array.from(files ?? []));
    if (paths.length === 0) {
      reportStatus(t('knowledgeBase.dropFailed'), 'error');
      return;
    }
    setBusy(true);
    clearStatus();
    try {
      setOverview(await window.electronAPI.knowledgeBase.uploadDocuments(paths));
      reportStatus(t('knowledgeBase.uploadQueued'), 'success');
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reparse(documentId: string) {
    if (busy) return;
    setBusy(true);
    clearStatus();
    try {
      setOverview(await window.electronAPI.knowledgeBase.reparseDocument(documentId));
      reportStatus(t('knowledgeBase.reparseQueued'), 'success');
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(documentId: string) {
    if (busy) return;
    if (!window.confirm(t('knowledgeBase.removeConfirm'))) return;
    setBusy(true);
    clearStatus();
    try {
      setOverview(await window.electronAPI.knowledgeBase.removeDocument(documentId));
      reportStatus(t('knowledgeBase.removeComplete'), 'success');
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reveal(documentId: string) {
    if (busy) return;
    setBusy(true);
    clearStatus();
    try {
      const result = await window.electronAPI.knowledgeBase.revealSource(documentId);
      if (!result.success) {
        reportStatus(
          t('knowledgeBase.revealFailed', {
            error: result.error || t('common.error'),
          }),
          'error'
        );
      }
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  const semanticStatus = getSemanticSearchDisplayStatus(appConfig, overview?.summary ?? null);

  async function rebuildEmbeddings() {
    if (busy) return;
    setBusy(true);
    clearStatus();
    try {
      setOverview(await window.electronAPI.knowledgeBase.rebuildEmbeddings());
      reportStatus(t('knowledgeBase.rebuildEmbeddingsComplete'), 'success');
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function semanticSearchMetricLabel(): string {
    switch (semanticStatus) {
      case 'active':
        return t('common.enabled');
      case 'pending_rebuild':
        return t('knowledgeBase.semanticSearchPending');
      case 'ready_no_content':
        return t('knowledgeBase.semanticSearchReady');
      default:
        return t('common.disabled');
    }
  }

  function semanticSearchStatusMessage(): string {
    switch (semanticStatus) {
      case 'active':
        return t('knowledgeBase.semanticSearchOn');
      case 'pending_rebuild':
        return t('knowledgeBase.semanticSearchPendingHint');
      case 'ready_no_content':
        return t('knowledgeBase.semanticSearchReadyHint');
      default:
        return t('knowledgeBase.semanticSearchOff');
    }
  }

  async function toggleBuildingCode(enabled: boolean) {
    let serverId = buildingCodeServerId;
    if (!serverId) {
      const presets = await window.electronAPI.mcp.getPresets();
      const preset = presets['building-code'];
      if (!preset) return;
      const newServer = {
        id: `mcp-building-code-${Date.now()}`,
        name: preset.name,
        type: preset.type,
        command: preset.command,
        args: preset.args,
        env: { ...preset.env },
        url: preset.url,
        headers: preset.headers,
        enabled,
      };
      const result = await window.electronAPI.mcp.saveServer(newServer);
      if (!result.success) return;
      serverId = newServer.id;
      setBuildingCodeServerId(serverId);
      setBuildingCodeEnabled(enabled);
      return;
    }
    const servers = await window.electronAPI.mcp.getServers();
    const server = servers.find((item) => item.id === serverId);
    if (!server) return;
    await window.electronAPI.mcp.saveServer({ ...server, enabled });
    setBuildingCodeEnabled(enabled);
  }

  return (
    <div className="space-y-5">
      <ApiConfigBanner context="knowledgeBase" />
      <SettingsContentSection
        title={t('knowledgeBase.buildingCodeTitle')}
        description={t('knowledgeBase.buildingCodeDescription')}
      >
        <div className="space-y-4 rounded-xl border border-border-muted bg-background-secondary/60 p-4">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={buildingCodeEnabled}
              onChange={(event) => {
                void toggleBuildingCode(event.target.checked);
              }}
            />
            {t('knowledgeBase.buildingCodeEnable')}
          </label>
          <div className="grid gap-2 text-sm text-text-secondary md:grid-cols-3">
            <p>
              {t('knowledgeBase.documents')}:{' '}
              <span className="text-text-primary">{activeDocuments.length}</span>
            </p>
            <p>
              {t('knowledgeBase.sections')}:{' '}
              <span className="text-text-primary">{overview?.summary.sectionCount ?? 0}</span>
            </p>
            <p>
              {t('knowledgeBase.chunks')}:{' '}
              <span className="text-text-primary">{overview?.summary.chunkCount ?? 0}</span>
            </p>
          </div>
          <p className="text-sm text-text-secondary">{semanticSearchStatusMessage()}</p>
          {semanticStatus === 'pending_rebuild' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void rebuildEmbeddings()}
              className="inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
              {t('knowledgeBase.rebuildEmbeddings')}
            </button>
          )}
          {semanticStatus === 'not_configured' && (
            <button
              type="button"
              onClick={() => {
                setSettingsSection('embeddings');
                setSettingsTab('api');
                setShowSettings(true);
              }}
              className="text-sm text-accent hover:underline"
            >
              {t('api.configureEmbeddings')}
            </button>
          )}
        </div>
      </SettingsContentSection>
      <SettingsContentSection
        title={t('knowledgeBase.uploadTitle')}
        description={t('knowledgeBase.uploadDescription')}
      >
        <div
          className="rounded-lg border border-dashed border-border-muted bg-background-secondary px-4 py-6 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void uploadDropped(event.dataTransfer.files);
          }}
        >
          <UploadCloud className="mx-auto h-7 w-7 text-text-muted" />
          <button
            type="button"
            disabled={busy}
            onClick={pickAndUpload}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            <FileText className="h-4 w-4" />
            {t('knowledgeBase.chooseFiles')}
          </button>
          {status && (
            <p
              className={`mt-3 text-sm ${
                statusTone === 'error' ? 'text-red-500' : 'text-text-muted'
              }`}
            >
              {status}
            </p>
          )}
        </div>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('knowledgeBase.documentsTitle')}
        description={t('knowledgeBase.documentsDescription')}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Metric label={t('knowledgeBase.sections')} value={overview?.summary.sectionCount ?? 0} />
          <Metric label={t('knowledgeBase.tables')} value={overview?.summary.tableCount ?? 0} />
          <Metric label={t('knowledgeBase.chunks')} value={overview?.summary.chunkCount ?? 0} />
          <Metric
            label={t('knowledgeBase.resolvedRefs')}
            value={overview?.summary.resolvedReferenceCount ?? 0}
          />
          <Metric
            label={t('knowledgeBase.unresolvedRefs')}
            value={overview?.summary.unresolvedReferenceCount ?? 0}
          />
          <Metric
            label={t('knowledgeBase.semanticSearch')}
            value={semanticSearchMetricLabel()}
          />
        </div>
        {semanticStatus === 'pending_rebuild' && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-text-secondary">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <span className="flex-1">{t('knowledgeBase.semanticSearchPendingHint')}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void rebuildEmbeddings()}
              className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {t('knowledgeBase.rebuildEmbeddings')}
            </button>
          </div>
        )}
        <div className="mt-4 space-y-2">
          {activeDocuments.length === 0 && (
            <p className="rounded-lg border border-border-muted p-4 text-sm text-text-muted">
              {t('knowledgeBase.emptyDocuments')}
            </p>
          )}
          {activeDocuments.map((document) => (
            <DocumentRow
              key={document.documentId}
              document={document}
              disabled={busy}
              t={t}
              actionLabels={actionLabels}
              onReparse={() => void reparse(document.documentId)}
              onRemove={() => void remove(document.documentId)}
              onReveal={() => void reveal(document.documentId)}
            />
          ))}
        </div>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('knowledgeBase.graphTitle')}
        description={t('knowledgeBase.graphDescription')}
      >
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]">
            <div className="max-h-64 overflow-auto rounded-lg border border-border-muted">
              {graphNodes.map((node) => (
                <button
                  key={node.nodeId}
                  type="button"
                  disabled={busy}
          onClick={() => setSelectedNodeId(node.nodeId)}
                  title={`${node.logicalRef} ${node.title}`}
                  className={`block w-full min-w-0 border-b border-border-muted px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${selectedNode?.nodeId === node.nodeId ? 'bg-accent/10' : 'hover:bg-surface-hover'}`}
                >
                  <span className="block min-w-0 truncate font-medium text-text-primary">
                    {node.logicalRef}
                  </span>
                  <span className="block min-w-0 truncate text-text-muted">{node.title}</span>
                </button>
              ))}
            </div>
            <div className="min-w-0 rounded-lg border border-border-muted p-3 text-sm">
              <p
                className="min-w-0 truncate font-medium text-text-primary"
                title={selectedNode?.logicalRef}
              >
                {selectedNode?.logicalRef ?? t('knowledgeBase.noNodeSelected')}
              </p>
              <p className="mt-1 min-w-0 break-words text-text-muted" title={selectedNode?.title}>
                {selectedNode?.title}
              </p>
              <p className="mt-3 break-words text-text-muted">
                {t('knowledgeBase.edgeCounts', {
                  resolved: selectedNodeEdgeCounts.resolved,
                  unresolved: selectedNodeEdgeCounts.unresolved,
                })}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-border-muted p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-text-primary">
                {t('knowledgeBase.unresolvedRefs')}
              </p>
              <p className="text-xs text-text-muted">{unresolvedReferenceEdges.length}</p>
            </div>
            {unresolvedReferenceEdges.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">{t('knowledgeBase.noDiagnostics')}</p>
            ) : (
              <div className="mt-2 space-y-2">
                {unresolvedReferenceEdges.map((edge) => {
                  const sourceNode = graphNodes.find((node) => node.nodeId === edge.fromNodeId) ?? null;

                  return (
                    <button
                      key={`${edge.fromNodeId}:${edge.targetLogicalRef}:${edge.rawText}`}
                      type="button"
                      disabled={busy}
                      onClick={() => setSelectedNodeId(graphView.resolveNodeId(edge.fromNodeId))}
                      className="block w-full rounded-md border border-border-muted px-3 py-2 text-left text-sm hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="block min-w-0 truncate font-medium text-text-primary">
                        {edge.targetLogicalRef}
                      </span>
                      <span className="block min-w-0 truncate text-text-muted" title={sourceNode?.logicalRef}>
                        {sourceNode?.logicalRef ?? edge.rawText}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('knowledgeBase.diagnosticsTitle')}
        description={t('knowledgeBase.diagnosticsDescription')}
      >
        <div className="space-y-2">
          {(overview?.diagnostics ?? []).length === 0 && (
            <p className="text-sm text-text-muted">{t('knowledgeBase.noDiagnostics')}</p>
          )}
          {overview?.diagnostics.map((item, index) => (
            <details
              key={`${item.phase}-${index}`}
              className="rounded-lg border border-border-muted p-3"
            >
              <summary
                className="flex min-w-0 cursor-pointer items-center gap-2 text-sm font-medium text-text-primary"
                title={`${item.phase}: ${item.severity}`}
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span className="min-w-0 truncate">
                  {item.phase}: {item.severity}
                </span>
              </summary>
              <p className="mt-2 break-words text-sm text-text-muted" title={item.message}>
                {item.message}
              </p>
            </details>
          ))}
        </div>
      </SettingsContentSection>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border-muted p-3">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-text-primary">{value}</p>
    </div>
  );
}

function DocumentRow({
  document,
  disabled,
  t,
  actionLabels,
  onReparse,
  onRemove,
  onReveal,
}: {
  document: KnowledgeBaseDocumentRecord;
  disabled: boolean;
  t: TranslationFn;
  actionLabels: {
    reparse: string;
    revealSource: string;
    remove: string;
  };
  onReparse: () => void;
  onRemove: () => void;
  onReveal: () => void;
}) {
  const rowBusy = disabled || activeJobStatuses.has(document.status);
  const statusLabel = t(`knowledgeBase.statusLabels.${document.status}`, document.status);

  return (
    <div className="rounded-lg border border-border-muted p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="min-w-0 truncate text-sm font-medium text-text-primary"
            title={document.metadata.sourceTitle}
          >
            {document.metadata.sourceTitle}
          </p>
          <p
            className="mt-1 min-w-0 truncate text-xs text-text-muted"
            title={`${document.originalFilename} · ${statusLabel} · ${
              document.parseCompletedAt || document.uploadedAt
            }`}
          >
            {document.originalFilename} · {statusLabel} ·{' '}
            {document.parseCompletedAt || document.uploadedAt}
          </p>
          <p
            className="mt-1 min-w-0 truncate text-xs text-text-muted"
            title={`${document.metadata.edition || '-'} · ${
              document.metadata.jurisdictionScope || '-'
            }`}
          >
            {document.metadata.edition || '-'} · {document.metadata.jurisdictionScope || '-'}
          </p>
          {document.progress && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
              <span
                className="inline-flex min-w-0 items-center gap-1.5"
                title={document.progress?.message}
              >
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
                <span className="min-w-0 truncate">{document.progress?.message}</span>
              </span>
              <span>{t('knowledgeBase.ocrPages', { count: document.progress.ocrPageCount })}</span>
            </div>
          )}
          {document.failureMessage && (
            <p className="mt-2 break-words text-xs text-red-500" title={document.failureMessage}>
              {document.failureMessage}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={rowBusy}
            onClick={onReparse}
            className="rounded-md p-2 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            title={actionLabels.reparse}
            aria-label={actionLabels.reparse}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={rowBusy}
            onClick={onReveal}
            className="rounded-md p-2 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            title={actionLabels.revealSource}
            aria-label={actionLabels.revealSource}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={rowBusy}
            onClick={onRemove}
            className="rounded-md p-2 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            title={actionLabels.remove}
            aria-label={actionLabels.remove}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
