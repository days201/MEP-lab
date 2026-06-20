import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, FolderOpen, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { KnowledgeBaseDocumentRecord, KnowledgeBaseOverview } from '../../types';
import { SettingsContentSection } from './shared';

export function SettingsKnowledgeBase() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<KnowledgeBaseOverview | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedNode = useMemo(
    () =>
      overview?.graph.nodes.find((node) => node.nodeId === selectedNodeId) ??
      overview?.graph.nodes[0] ??
      null,
    [overview, selectedNodeId]
  );

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

  useEffect(() => {
    void refresh().catch((error) =>
      setStatus(error instanceof Error ? error.message : String(error))
    );
  }, []);

  useEffect(() => {
    if (!overview) return;
    const nodes = overview.graph.nodes;
    if (nodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }
    if (!selectedNodeId || !nodes.some((node) => node.nodeId === selectedNodeId)) {
      setSelectedNodeId(nodes[0].nodeId);
    }
  }, [overview, selectedNodeId]);

  async function pickAndUpload() {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      const files = await window.electronAPI.knowledgeBase.selectDocuments();
      if (files.length === 0) return;
      setOverview(await window.electronAPI.knowledgeBase.uploadDocuments(files));
      setStatus(t('knowledgeBase.uploadComplete'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadDropped(files: FileList | null) {
    if (busy) return;
    const paths = window.electronAPI.knowledgeBase.getDroppedFilePaths(Array.from(files ?? []));
    if (paths.length === 0) return;
    setBusy(true);
    setStatus('');
    try {
      setOverview(await window.electronAPI.knowledgeBase.uploadDocuments(paths));
      setStatus(t('knowledgeBase.uploadComplete'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function reparse(documentId: string) {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      setOverview(await window.electronAPI.knowledgeBase.reparseDocument(documentId));
      setStatus(t('knowledgeBase.reparseComplete'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(documentId: string) {
    if (busy) return;
    if (!window.confirm(t('knowledgeBase.removeConfirm'))) return;
    setBusy(true);
    setStatus('');
    try {
      setOverview(await window.electronAPI.knowledgeBase.removeDocument(documentId));
      setStatus(t('knowledgeBase.removeComplete'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function reveal(documentId: string) {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await window.electronAPI.knowledgeBase.revealSource(documentId);
      if (!result.success) {
        setStatus(
          t('knowledgeBase.revealFailed', {
            error: result.error || t('common.error'),
          })
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const activeDocuments =
    overview?.documents.filter((document) => document.status !== 'removed') ?? [];

  return (
    <div className="space-y-5">
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
          {status && <p className="mt-3 text-sm text-text-muted">{status}</p>}
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
            value={
              overview?.summary.semanticSearchAvailable ? t('common.enabled') : t('common.disabled')
            }
          />
        </div>
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
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]">
          <div className="max-h-64 overflow-auto rounded-lg border border-border-muted">
            {overview?.graph.nodes.map((node) => (
              <button
                key={node.nodeId}
                type="button"
                onClick={() => setSelectedNodeId(node.nodeId)}
                title={`${node.logicalRef} ${node.title}`}
                className={`block w-full min-w-0 border-b border-border-muted px-3 py-2 text-left text-sm ${selectedNode?.nodeId === node.nodeId ? 'bg-accent/10' : 'hover:bg-surface-hover'}`}
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
                resolved: overview?.graph.referenceEdgeCount ?? 0,
                unresolved: overview?.graph.unresolvedReferenceCount ?? 0,
              })}
            </p>
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
  actionLabels,
  onReparse,
  onRemove,
  onReveal,
}: {
  document: KnowledgeBaseDocumentRecord;
  disabled: boolean;
  actionLabels: {
    reparse: string;
    revealSource: string;
    remove: string;
  };
  onReparse: () => void;
  onRemove: () => void;
  onReveal: () => void;
}) {
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
            title={`${document.originalFilename} · ${document.status} · ${
              document.parseCompletedAt || document.uploadedAt
            }`}
          >
            {document.originalFilename} · {document.status} ·{' '}
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
          {document.failureMessage && (
            <p className="mt-2 break-words text-xs text-red-500" title={document.failureMessage}>
              {document.failureMessage}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={disabled}
            onClick={onReparse}
            className="rounded-md p-2 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            title={actionLabels.reparse}
            aria-label={actionLabels.reparse}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onReveal}
            className="rounded-md p-2 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            title={actionLabels.revealSource}
            aria-label={actionLabels.revealSource}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disabled}
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
