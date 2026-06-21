import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const panel = readFileSync(
  path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx'),
  'utf8'
);
const componentPath = path.resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsKnowledgeBase.tsx'
);
const en = readFileSync(path.resolve(process.cwd(), 'src/renderer/i18n/locales/en.json'), 'utf8');
const zh = readFileSync(path.resolve(process.cwd(), 'src/renderer/i18n/locales/zh.json'), 'utf8');

describe('SettingsPanel Knowledge Base entry', () => {
  it('adds the Knowledge Base tab beside operational settings', () => {
    expect(panel).toContain("id: 'knowledgeBase' as TabId");
    expect(panel).toContain('SettingsKnowledgeBase');
    expect(panel).toContain("viewedTabs.has('knowledgeBase')");
  });

  it('renders upload, documents, graph, diagnostics, and actions', () => {
    const component = readFileSync(componentPath, 'utf8');
    expect(component).toContain('window.electronAPI.knowledgeBase.getOverview');
    expect(component).toContain('window.electronAPI.knowledgeBase.uploadDocuments');
    expect(component).toContain('window.electronAPI.knowledgeBase.reparseDocument');
    expect(component).toContain('window.electronAPI.knowledgeBase.removeDocument');
    expect(component).toContain('window.electronAPI.knowledgeBase.revealSource');
    expect(component).toContain('window.electronAPI.knowledgeBase.getDroppedFilePaths');
    expect(component).not.toContain("('path' in file");
    expect(component).toContain("reportStatus(t('knowledgeBase.uploadQueued'), 'success')");
    expect(component).toContain("reportStatus(t('knowledgeBase.reparseQueued'), 'success')");
    expect(component).toContain("reportStatus(t('knowledgeBase.removeComplete'), 'success')");
    expect(component).toContain("reportStatus(t('knowledgeBase.dropFailed'), 'error')");
    expect(component).toContain("t('knowledgeBase.revealFailed'");
    expect(component).toContain('statusTone === \'error\'');
    expect(component).toContain('selectedNodeEdgeCounts');
    expect(component).toContain("t('knowledgeBase.uploadTitle')");
    expect(component).toContain("t('knowledgeBase.graphTitle')");
    expect(component).toContain("t('knowledgeBase.diagnosticsTitle')");
    expect(component).toContain('buildKnowledgeBaseGraphViewModel');
    expect(component).toContain("graphView.edges.filter((edge) => edge.status === 'unresolved')");
    expect(component).toContain('graphView.resolveNodeId(edge.fromNodeId)');
    expect(component).toContain('targetLogicalRef');
    expect(component).toContain('unresolvedReferenceCount');
    expect(component).toContain('disabled={busy}');
    expect(component).toContain('actionLabels={actionLabels}');
  });

  it('shows queued parse progress without OCR or parser controls', () => {
    const component = readFileSync(componentPath, 'utf8');
    expect(component).toContain('const activeJobStatuses');
    expect(component).toContain('setInterval');
    expect(component).toContain('let cancelled = false');
    expect(component).toContain('let refreshing = false');
    expect(component).toContain('document.progress?.message');
    expect(component).toContain('t(`knowledgeBase.statusLabels.${document.status}`');
    expect(component).toContain('RefreshCw');
    expect(component).not.toMatch(/ocrToggle|ocrMode|OCR toggle|parser selector/i);
  });

  it('adds English i18n labels', () => {
    expect(en).toContain('"knowledgeBase"');
    expect(en).toContain('"uploadTitle"');
    expect(en).toContain('"emptyDocuments"');
    expect(en).toContain('"reparseAction"');
    expect(en).toContain('"revealSourceAction"');
    expect(en).toContain('"removeAction"');
    expect(en).toContain('"dropFailed"');
  });

  it('adds parse status labels and progress copy in English and Chinese', () => {
    for (const locale of [JSON.parse(en), JSON.parse(zh)]) {
      expect(locale.knowledgeBase).toHaveProperty('statusLabels');
      expect(locale.knowledgeBase.statusLabels).toHaveProperty('interrupted');
      expect(locale.knowledgeBase.statusLabels).toHaveProperty('ocr');
      expect(locale.knowledgeBase.statusLabels).toHaveProperty('ready_with_warnings');
      expect(locale.knowledgeBase).toHaveProperty('ocrPages');
    }
  });
});
