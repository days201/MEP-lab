import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeBaseService } from '../src/main/mcp/building-code/knowledge-base-service';
import type { NormalizedDoclingResult } from '../src/main/mcp/building-code/docling-parser';
import { saveBuildingCodeIndex } from '../src/main/mcp/building-code/index-store';
import type { BuildingCodeIndex } from '../src/main/mcp/building-code/index-store';

const roots: string[] = [];

function parsed(): NormalizedDoclingResult {
  return {
    parserName: 'docling',
    parserVersion: '2.0.0',
    pages: [{ pageNumber: 1, text: 'Section 9.10.3.1 Fire separations\nBody text.' }],
    elements: [
      {
        elementId: 'h1',
        kind: 'heading',
        text: 'Section 9.10.3.1 Fire separations',
        pageNumber: 1,
        level: 2,
        confidence: 0.99,
        bbox: null,
      },
      {
        elementId: 'p1',
        kind: 'text',
        text: 'Body text.',
        pageNumber: 1,
        level: null,
        confidence: 0.99,
        bbox: null,
      },
    ],
    tables: [],
    diagnostics: [],
  };
}

function parsedWithoutCanonicalHeadings(): NormalizedDoclingResult {
  return {
    parserName: 'docling',
    parserVersion: '2.0.0',
    pages: [{ pageNumber: 1, text: 'General notes\nBody text.' }],
    elements: [
      {
        elementId: 'h1',
        kind: 'heading',
        text: 'General notes',
        pageNumber: 1,
        level: 2,
        confidence: 0.99,
        bbox: null,
      },
      {
        elementId: 'p1',
        kind: 'text',
        text: 'Body text.',
        pageNumber: 1,
        level: null,
        confidence: 0.99,
        bbox: null,
      },
    ],
    tables: [],
    diagnostics: [],
  };
}

function activeIndexSnapshot(userData: string): {
  indexFile: string;
  vectorFile: string;
  index: { nodes: unknown[]; semanticSearchAvailable: boolean };
  vectors: { vectors: unknown[] };
} {
  const indexDir = path.join(userData, 'knowledge-base', 'building-code', 'index');
  const indexFile = fs.readFileSync(path.join(indexDir, 'index.json'), 'utf8');
  const vectorFile = fs.readFileSync(path.join(indexDir, 'vectors.json'), 'utf8');

  return {
    indexFile,
    vectorFile,
    index: JSON.parse(indexFile) as { nodes: unknown[]; semanticSearchAvailable: boolean },
    vectors: JSON.parse(vectorFile) as { vectors: unknown[] },
  };
}

describe('KnowledgeBaseService', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uploads, parses, embeds, registers, and writes an active index', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => parsed(),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    const overview = await service.uploadDocuments([source]);

    expect(overview.documents[0]).toMatchObject({ status: 'ready', documentId: 'doc-1' });
    expect(overview.summary.nodeCount).toBe(1);
    expect(overview.summary.semanticSearchAvailable).toBe(true);
    expect(fs.existsSync(path.join(userData, 'knowledge-base', 'building-code', 'index', 'index.json'))).toBe(true);
  });

  it('keeps the prior active index when parsing a new document fails', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const good = path.join(userData, 'good.md');
    const bad = path.join(userData, 'bad.md');
    fs.writeFileSync(good, 'Section 9.10.3.1 Fire separations\nBody text.');
    fs.writeFileSync(bad, 'No canonical headings here.');
    let shouldFail = false;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => (shouldFail ? 'doc-bad' : 'doc-good'),
      parseDocument: async () => {
        if (shouldFail) throw new Error('parser exploded');
        return parsed();
      },
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([good]);
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    shouldFail = true;
    const after = await service.uploadDocuments([bad]);
    const afterIndex = activeIndexSnapshot(userData);

    expect(after.documents.find((document) => document.documentId === 'doc-bad')).toMatchObject({
      status: 'failed',
      failureMessage: 'parser exploded',
    });
    expect(after.summary.nodeCount).toBe(before.summary.nodeCount);
    expect(after.summary.semanticSearchAvailable).toBe(true);
    expect(afterIndex.index.nodes).toEqual(beforeIndex.index.nodes);
    expect(afterIndex.index.semanticSearchAvailable).toBe(true);
    expect(afterIndex.vectors.vectors).toEqual(beforeIndex.vectors.vectors);
  });

  it('preserves the prior active index when reparsing an active document fails', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    let shouldFail = false;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => {
        if (shouldFail) throw new Error('parser exploded');
        return parsed();
      },
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    shouldFail = true;
    const after = await service.reparseDocument('doc-1');
    const afterIndex = activeIndexSnapshot(userData);

    expect(after.documents.find((document) => document.documentId === 'doc-1')).toMatchObject({
      status: 'failed',
      failureMessage: 'parser exploded',
    });
    expect(after.summary).toMatchObject({
      nodeCount: before.summary.nodeCount,
      semanticSearchAvailable: true,
    });
    expect(after.graph.nodes).toEqual(before.graph.nodes);
    expect(afterIndex.index.nodes).toEqual(beforeIndex.index.nodes);
    expect(afterIndex.index.semanticSearchAvailable).toBe(true);
    expect(afterIndex.vectors.vectors).toEqual(beforeIndex.vectors.vectors);
  });

  it('keeps the full prior active index when one active document fails canonicalization during rebuild', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const sourceA = path.join(userData, 'a.md');
    const sourceB = path.join(userData, 'b.md');
    fs.writeFileSync(sourceA, 'Section 9.10.3.1 Fire separations\nBody text.');
    fs.writeFileSync(sourceB, 'Section 9.10.3.1 Fire separations\nBody text.');
    let nextId = 0;
    let reparsingBadDocument = false;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => `doc-${++nextId}`,
      parseDocument: async () => (reparsingBadDocument ? parsedWithoutCanonicalHeadings() : parsed()),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([sourceA, sourceB]);
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    const beforeGoodDocument = before.documents.find((document) => document.documentId === 'doc-1');
    reparsingBadDocument = true;
    const after = await service.reparseDocument('doc-2');
    const afterIndex = activeIndexSnapshot(userData);
    const afterGoodDocument = after.documents.find((document) => document.documentId === 'doc-1');

    expect(before.summary.nodeCount).toBe(2);
    expect(after.documents.find((document) => document.documentId === 'doc-2')).toMatchObject({
      status: 'failed',
      failureMessage: 'no canonical building-code sections found',
    });
    expect(after.summary.nodeCount).toBe(before.summary.nodeCount);
    expect(after.summary.semanticSearchAvailable).toBe(true);
    expect(afterIndex.index.nodes).toEqual(beforeIndex.index.nodes);
    expect(afterIndex.index.semanticSearchAvailable).toBe(true);
    expect(afterIndex.vectors.vectors).toEqual(beforeIndex.vectors.vectors);
    expect(afterGoodDocument?.lastIndexRebuildAt).toBe(beforeGoodDocument?.lastIndexRebuildAt);
  });

  it('preserves the prior active index and document summaries when saving a rebuilt index fails', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    let failSave = false;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => (failSave ? '2026-06-19T12:05:00.000Z' : '2026-06-19T12:00:00.000Z'),
      randomId: () => 'doc-1',
      parseDocument: async () => parsed(),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
      saveIndex: async (indexDir: string, index: BuildingCodeIndex) => {
        if (failSave) {
          throw new Error(`cannot save index at ${indexDir} with ${index.nodes.length} nodes`);
        }
        await saveBuildingCodeIndex(indexDir, index);
      },
    });

    await service.uploadDocuments([source]);
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    failSave = true;
    const after = await service.reparseDocument('doc-1');
    const afterIndex = activeIndexSnapshot(userData);

    expect(after.summary).toEqual(before.summary);
    expect(after.documents[0].status).toBe('embedding');
    expect(after.documents[0].indexSummary).toEqual(before.documents[0].indexSummary);
    expect(after.documents[0].lastIndexRebuildAt).toBe(before.documents[0].lastIndexRebuildAt);
    expect(afterIndex.indexFile).toBe(beforeIndex.indexFile);
    expect(afterIndex.vectorFile).toBe(beforeIndex.vectorFile);
  });

  it('preserves the prior registry status and active index when removing a document fails to save the rebuild', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    let failSave = false;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => (failSave ? '2026-06-19T12:05:00.000Z' : '2026-06-19T12:00:00.000Z'),
      randomId: () => 'doc-1',
      parseDocument: async () => parsed(),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
      saveIndex: async (indexDir: string, index: BuildingCodeIndex) => {
        if (failSave) {
          throw new Error(`cannot save index at ${indexDir} with ${index.nodes.length} nodes`);
        }
        await saveBuildingCodeIndex(indexDir, index);
      },
    });

    await service.uploadDocuments([source]);
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    failSave = true;
    const after = await service.removeDocument('doc-1');
    const afterIndex = activeIndexSnapshot(userData);

    expect(after.summary).toEqual(before.summary);
    expect(after.graph.nodes).toEqual(before.graph.nodes);
    expect(after.documents[0].status).toBe('ready');
    expect(after.documents[0].indexSummary).toEqual(before.documents[0].indexSummary);
    expect(after.documents[0].lastIndexRebuildAt).toBe(before.documents[0].lastIndexRebuildAt);
    expect(afterIndex.indexFile).toBe(beforeIndex.indexFile);
    expect(afterIndex.vectorFile).toBe(beforeIndex.vectorFile);
  });

  it('restores all active registry records when removal rebuild fails canonicalization', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const sourceA = path.join(userData, 'a.md');
    const sourceB = path.join(userData, 'b.md');
    fs.writeFileSync(sourceA, 'Section 9.10.3.1 Fire separations\nBody text.');
    fs.writeFileSync(sourceB, 'Section 9.11.1.1 Sound control\nBody text.');
    let nextId = 0;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => `doc-${++nextId}`,
      parseDocument: async () => parsed(),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([sourceA, sourceB]);
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    fs.writeFileSync(
      path.join(userData, 'knowledge-base', 'building-code', 'parsed', 'doc-2.json'),
      `${JSON.stringify(parsedWithoutCanonicalHeadings(), null, 2)}\n`
    );
    const after = await service.removeDocument('doc-1');
    const afterIndex = activeIndexSnapshot(userData);

    expect(before.summary.nodeCount).toBe(2);
    expect(after.summary).toEqual(before.summary);
    expect(after.graph.nodes).toEqual(before.graph.nodes);
    expect(after.documents).toEqual(before.documents);
    expect(afterIndex.indexFile).toBe(beforeIndex.indexFile);
    expect(afterIndex.vectorFile).toBe(beforeIndex.vectorFile);
  });

  it('does not rebuild the active index when a new document parse failure is the only batch change', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const good = path.join(userData, 'good.md');
    const bad = path.join(userData, 'bad.md');
    fs.writeFileSync(good, 'Section 9.10.3.1 Fire separations\nBody text.');
    fs.writeFileSync(bad, 'No canonical headings here.');
    let shouldFail = false;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => (shouldFail ? 'doc-bad' : 'doc-good'),
      parseDocument: async () => {
        if (shouldFail) throw new Error('parser exploded');
        return parsed();
      },
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => {
          if (shouldFail) throw new Error('embedding should not be called');
          return texts.map(() => [1, 0, 0]);
        },
      }),
    });

    await service.uploadDocuments([good]);
    const before = activeIndexSnapshot(userData);
    expect(before.index.semanticSearchAvailable).toBe(true);
    expect(before.vectors.vectors.length).toBeGreaterThan(0);
    shouldFail = true;
    const after = await service.uploadDocuments([bad]);
    const afterIndex = activeIndexSnapshot(userData);

    expect(after.documents.find((document) => document.documentId === 'doc-bad')).toMatchObject({
      status: 'failed',
      failureMessage: 'parser exploded',
    });
    expect(after.summary.semanticSearchAvailable).toBe(true);
    expect(afterIndex.indexFile).toBe(before.indexFile);
    expect(afterIndex.vectorFile).toBe(before.vectorFile);
    expect(afterIndex.index.nodes).toHaveLength(before.index.nodes.length);
    expect(afterIndex.vectors.vectors).toEqual(before.vectors.vectors);
  });

  it('marks embedding failures while preserving exact lookup records', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => parsed(),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async () => {
          throw new Error('embedding endpoint down');
        },
      }),
    });

    const overview = await service.uploadDocuments([source]);

    expect(overview.documents[0].status).toBe('ready_with_warnings');
    expect(overview.summary.nodeCount).toBe(1);
    expect(overview.summary.semanticSearchAvailable).toBe(false);
    expect(overview.diagnostics.map((item) => item.message).join('\n')).toContain('embedding endpoint down');
  });

  it('throws when removing an unknown document id', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => parsed(),
    });

    await expect(service.removeDocument('missing-doc')).rejects.toThrow(
      'Knowledge-base document not found: missing-doc'
    );
  });

  it('throws when removing an already removed document id', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => parsed(),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    await service.removeDocument('doc-1');

    await expect(service.removeDocument('doc-1')).rejects.toThrow(
      'Knowledge-base document not found: doc-1'
    );
  });

  it('keeps the original parse start timestamp when upload parsing fails', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const times = [
      '2026-06-19T12:00:00.000Z',
      '2026-06-19T12:01:00.000Z',
      '2026-06-19T12:02:00.000Z',
    ];
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => times.shift() ?? '2026-06-19T12:03:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => {
        throw new Error('parser exploded');
      },
    });

    const overview = await service.uploadDocuments([source]);

    expect(overview.documents[0]).toMatchObject({
      status: 'failed',
      parseStartedAt: '2026-06-19T12:01:00.000Z',
      parseCompletedAt: '2026-06-19T12:02:00.000Z',
    });
  });
});
