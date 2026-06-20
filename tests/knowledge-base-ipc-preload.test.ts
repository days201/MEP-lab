import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('knowledge-base IPC and preload surface', () => {
  const mainIndex = readFileSync(path.resolve(process.cwd(), 'src/main/index.ts'), 'utf8');
  const preload = readFileSync(path.resolve(process.cwd(), 'src/preload/index.ts'), 'utf8');
  const ipcTypes = readFileSync(path.resolve(process.cwd(), 'src/shared/ipc-types.ts'), 'utf8');
  const rendererTypes = readFileSync(
    path.resolve(process.cwd(), 'src/renderer/types/index.ts'),
    'utf8'
  );
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
    expect(preload).toContain("import { contextBridge, ipcRenderer, webUtils } from 'electron';");
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.getOverview')");
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.selectDocuments')");
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.uploadDocuments'");
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.reparseDocument'");
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.removeDocument'");
    expect(preload).toContain("ipcRenderer.invoke('knowledgeBase.revealSource'");
    expect(preload).toContain('getDroppedFilePaths: (files: File[]): string[] =>');
    expect(preload).toContain('webUtils.getPathForFile(file)');
    expect(preload).toContain('getDroppedFilePaths: (files: File[]) => string[];');
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

  it('constructs the knowledge-base service with parser-neutral LiteParse defaults', () => {
    expect(mainIndex).toContain('const knowledgeBaseOptions: KnowledgeBaseServiceOptions = {');
    expect(mainIndex).toContain('userDataPath: app.getPath(\'userData\'),');
    expect(mainIndex).toContain('knowledgeBaseService = new KnowledgeBaseService(knowledgeBaseOptions);');
    expect(mainIndex).not.toContain('pythonPath: resolveDoclingPythonPath(),');
    expect(knowledgeBaseService).toContain('parseDocumentWithLiteParse(input)');
    expect(knowledgeBaseService).toContain("parserName: 'liteparse'");
    expect(knowledgeBaseService).not.toContain('parseDocumentWithDocling({');
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
    expect(ipcTypes).toContain('export interface KnowledgeBaseParseProgress');
    expect(ipcTypes).toContain("| 'ocr'");
    expect(ipcTypes).toContain("| 'canonicalizing'");
    expect(ipcTypes).toContain("| 'interrupted'");
    expect(ipcTypes).toContain('parserName: KnowledgeBaseParserName;');
    expect(ipcTypes).toContain('progress: KnowledgeBaseParseProgress | null;');
    expect(rendererTypes).toContain('KnowledgeBaseParseProgress');
    expect(rendererTypes).toContain('KnowledgeBaseParserName');
  });
});
