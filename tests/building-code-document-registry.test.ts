import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentRegistry } from '../src/main/mcp/building-code/document-registry';
import type { KnowledgeBaseDocumentRecord } from '../src/shared/ipc-types';

const roots: string[] = [];

function record(overrides: Partial<KnowledgeBaseDocumentRecord> = {}): KnowledgeBaseDocumentRecord {
  return {
    documentId: 'doc-1',
    originalFilename: 'NBC.pdf',
    detectedFileType: 'pdf',
    mimeType: 'application/pdf',
    sourceChecksum: 'sha256:abc',
    sourcePath: '/tmp/NBC.pdf',
    sourceUri: 'kb://building-code/doc-1/NBC.pdf',
    parserName: 'docling',
    parserVersion: '2.0.0',
    status: 'queued',
    uploadedAt: '2026-06-19T12:00:00.000Z',
    parseStartedAt: null,
    parseCompletedAt: null,
    lastIndexRebuildAt: null,
    metadata: {
      codeFamily: 'NBC',
      edition: '2025',
      jurisdictionScope: 'Canada',
      sourceTitle: 'NBC 2025',
    },
    diagnostics: [],
    failureMessage: null,
    indexSummary: {
      nodeCount: 0,
      tableCount: 0,
      chunkCount: 0,
      resolvedReferenceCount: 0,
      unresolvedReferenceCount: 0,
      sectionCount: 0,
      semanticSearchAvailable: false,
    },
    ...overrides,
  };
}

describe('building-code document registry', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates an empty registry when documents.json is absent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-registry-'));
    roots.push(root);
    const registry = new DocumentRegistry(path.join(root, 'documents.json'));

    await expect(registry.list()).resolves.toEqual([]);
  });

  it('upserts and persists document records atomically', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-registry-'));
    roots.push(root);
    const registryPath = path.join(root, 'documents.json');
    const registry = new DocumentRegistry(registryPath);

    await registry.upsert(record());
    await registry.upsert(record({ status: 'ready', parseCompletedAt: '2026-06-19T12:01:00.000Z' }));

    const reloaded = new DocumentRegistry(registryPath);
    expect(await reloaded.get('doc-1')).toMatchObject({ status: 'ready' });
  });

  it('marks removed documents without deleting their audit record', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-registry-'));
    roots.push(root);
    const registry = new DocumentRegistry(path.join(root, 'documents.json'));

    await registry.upsert(record());
    await registry.markRemoved('doc-1', '2026-06-19T12:02:00.000Z');

    expect(await registry.get('doc-1')).toMatchObject({
      status: 'removed',
      failureMessage: null,
    });
  });
});
