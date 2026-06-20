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
    expect(component).toContain("setStatus(t('knowledgeBase.reparseComplete'))");
    expect(component).toContain("setStatus(t('knowledgeBase.removeComplete'))");
    expect(component).toContain("t('knowledgeBase.revealFailed'");
    expect(component).toContain("t('knowledgeBase.uploadTitle')");
    expect(component).toContain("t('knowledgeBase.graphTitle')");
    expect(component).toContain("t('knowledgeBase.diagnosticsTitle')");
    expect(component).toContain('disabled={busy}');
    expect(component).toContain('actionLabels={actionLabels}');
  });

  it('adds English i18n labels', () => {
    expect(en).toContain('"knowledgeBase"');
    expect(en).toContain('"uploadTitle"');
    expect(en).toContain('"emptyDocuments"');
    expect(en).toContain('"reparseAction"');
    expect(en).toContain('"revealSourceAction"');
    expect(en).toContain('"removeAction"');
  });
});
