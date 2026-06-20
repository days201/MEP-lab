import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('knowledge-base IPC and preload surface', () => {
  const mainIndex = readFileSync(path.resolve(process.cwd(), 'src/main/index.ts'), 'utf8');
  const preload = readFileSync(path.resolve(process.cwd(), 'src/preload/index.ts'), 'utf8');
  const ipcTypes = readFileSync(path.resolve(process.cwd(), 'src/shared/ipc-types.ts'), 'utf8');
  const knowledgeBaseService = readFileSync(
    path.resolve(process.cwd(), 'src/main/mcp/building-code/knowledge-base-service.ts'),
    'utf8'
  );

  it('registers main-process knowledge-base handlers', () => {
    expect(mainIndex).toContain("ipcMain.handle('knowledgeBase.getOverview'");
    expect(mainIndex).toContain("ipcMain.handle('knowledgeBase.selectDocuments'");
    expect(mainIndex).toContain("ipcMain.handle('knowledgeBase.uploadDocuments'");
    expect(mainIndex).toContain("ipcMain.handle('knowledgeBase.reparseDocument'");
    expect(mainIndex).toContain("ipcMain.handle('knowledgeBase.removeDocument'");
    expect(mainIndex).toContain("ipcMain.handle('knowledgeBase.revealSource'");
  });

  it('exposes renderer-safe preload methods', () => {
    expect(preload).toContain('knowledgeBase: {');
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.getOverview')");
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.selectDocuments')");
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.uploadDocuments'");
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.reparseDocument'");
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.removeDocument'");
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.revealSource'");
  });

  it('uses a safe optional dialog owner for knowledge-base document selection', () => {
    const selectHandler = mainIndex.slice(
      mainIndex.indexOf("ipcMain.handle('knowledgeBase.selectDocuments'"),
      mainIndex.indexOf('// Config IPC handlers')
    );
    expect(selectHandler).toContain(
      'const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;'
    );
    expect(selectHandler).toContain('await dialog.showOpenDialog(owner, options)');
    expect(selectHandler).toContain('await dialog.showOpenDialog(options)');
    expect(selectHandler).not.toContain('mainWindow!');
  });

  it('wires pythonPath as a KnowledgeBaseService dependency', () => {
    expect(mainIndex).toContain('const knowledgeBaseOptions: KnowledgeBaseServiceOptions = {');
    expect(mainIndex).toContain('function resolveDoclingPythonPath(): string');
    expect(mainIndex).toContain('process.env.DOCLING_PYTHON_PATH?.trim()');
    expect(mainIndex).toContain('pythonPath: resolveDoclingPythonPath(),');
    expect(mainIndex).toContain('knowledgeBaseService = new KnowledgeBaseService(knowledgeBaseOptions);');
    expect(mainIndex).not.toContain('DOCLING_PYTHON_PATH ||= knowledgeBasePythonPath');
    expect(knowledgeBaseService).toContain('pythonPath?: string;');
    expect(knowledgeBaseService).toContain('private readonly pythonPath: string;');
    expect(knowledgeBaseService).toContain("this.pythonPath = options.pythonPath ?? 'python';");
    expect(knowledgeBaseService).toContain('pythonPath: this.pythonPath,');
  });

  it('validates runtime IPC payloads before calling the service', () => {
    expect(mainIndex).toContain('function assertKnowledgeBaseFilePaths(filePaths: unknown): string[]');
    expect(mainIndex).toContain(
      "throw new Error('Knowledge Base upload requires an array of file paths')"
    );
    expect(mainIndex).toContain(
      "throw new Error('Knowledge Base upload file paths must be non-empty strings')"
    );
    expect(mainIndex).toContain('function assertKnowledgeBaseDocumentId(documentId: unknown): string');
    expect(mainIndex).toContain(
      "throw new Error('Knowledge Base document id must be a non-empty string')"
    );
    expect(mainIndex).toContain('const validFilePaths = assertKnowledgeBaseFilePaths(filePaths);');
    expect(mainIndex).toContain('const validDocumentId = assertKnowledgeBaseDocumentId(documentId);');
  });

  it('declares shared renderer DTOs', () => {
    expect(ipcTypes).toContain('export interface KnowledgeBaseOverview');
    expect(ipcTypes).toContain('export interface KnowledgeBaseDocumentRecord');
    expect(ipcTypes).toContain('export interface KnowledgeBaseGraphSummary');
  });
});
