import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeBaseService } from '../src/main/mcp/building-code/knowledge-base-service';
import { createOpenAIEmbeddingClient } from '../src/main/mcp/building-code/embedding';
import type {
  NormalizedParserDocument,
  ParseDocumentProgress,
} from '../src/main/mcp/building-code/parser-adapter';
import { loadBuildingCodeIndex, saveBuildingCodeIndex } from '../src/main/mcp/building-code/index-store';
import type { BuildingCodeIndex } from '../src/main/mcp/building-code/index-store';

const roots: string[] = [];
let originalBuildingCodeIndexDir: string | undefined;

function parsed(parserName: NormalizedParserDocument['parserName'] = 'fixture'): NormalizedParserDocument {
  return {
    parserName,
    parserVersion: '2.0.0',
    pages: [
      {
        pageNumber: 1,
        text: 'Section 9.10.3.1 Fire separations\nBody text.',
        extractionMode: 'native',
        boundingBoxes: [],
      },
    ],
    elements: [
      {
        elementId: 'h1',
        kind: 'heading',
        text: 'Section 9.10.3.1 Fire separations',
        pageNumber: 1,
        level: 2,
        confidence: 0.99,
        bbox: null,
        sourceIds: ['p1-h1'],
      },
      {
        elementId: 'p1',
        kind: 'text',
        text: 'Body text.',
        pageNumber: 1,
        level: null,
        confidence: 0.99,
        bbox: null,
        sourceIds: ['p1-t1'],
      },
    ],
    tables: [],
    diagnostics: [],
    pageDiagnostics: [],
  };
}

function parsedWithoutCanonicalHeadings(): NormalizedParserDocument {
  return {
    parserName: 'fixture',
    parserVersion: '2.0.0',
    pages: [
      {
        pageNumber: 1,
        text: 'General notes\nBody text.',
        extractionMode: 'native',
        boundingBoxes: [],
      },
    ],
    elements: [
      {
        elementId: 'h1',
        kind: 'heading',
        text: 'General notes',
        pageNumber: 1,
        level: 2,
        confidence: 0.99,
        bbox: null,
        sourceIds: ['p1-h1'],
      },
      {
        elementId: 'p1',
        kind: 'text',
        text: 'Body text.',
        pageNumber: 1,
        level: null,
        confidence: 0.99,
        bbox: null,
        sourceIds: ['p1-t1'],
      },
    ],
    tables: [],
    diagnostics: [],
    pageDiagnostics: [],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function viWaitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 1000
): Promise<T> {
  const startedAt = Date.now();
  let latest = await read();

  while (!predicate(latest)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    latest = await read();
  }

  return latest;
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
  beforeEach(() => {
    originalBuildingCodeIndexDir = process.env.BUILDING_CODE_INDEX_DIR;
  });

  afterEach(() => {
    restoreEnv('BUILDING_CODE_INDEX_DIR', originalBuildingCodeIndexDir);
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

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    const overview = await service.getOverview();

    expect(overview.documents[0]).toMatchObject({ status: 'ready', documentId: 'doc-1' });
    expect(overview.summary.nodeCount).toBe(1);
    expect(overview.summary.semanticSearchAvailable).toBe(true);
    expect(fs.existsSync(path.join(userData, 'knowledge-base', 'building-code', 'index', 'index.json'))).toBe(true);
  });

  it('exposes unresolved graph references with their target logical refs', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => ({
        ...parsed(),
        pages: [
          {
            pageNumber: 1,
            text: 'Section 9.10.3.1 Fire separations\nFire separations shall comply with Table 9.10.3.2.',
            extractionMode: 'native',
            boundingBoxes: [],
          },
        ],
        elements: [
          parsed().elements[0],
          {
            elementId: 'p1',
            kind: 'text',
            text: 'Fire separations shall comply with Table 9.10.3.2.',
            pageNumber: 1,
            level: null,
            confidence: 0.99,
            bbox: null,
            sourceIds: ['p1'],
          },
        ],
        tables: [],
      }),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    const overview = await service.getOverview();

    expect(overview.graph.edges).toContainEqual(
      expect.objectContaining({
        rawText: 'Table 9.10.3.2',
        targetLogicalRef: 'Table 9.10.3.2',
        status: 'unresolved',
      })
    );
  });

  it('registers uploads immediately and parses them in the background', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const parseDeferred = deferred<NormalizedParserDocument>();
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => parseDeferred.promise,
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    const immediate = await service.uploadDocuments([source]);

    expect(immediate.documents[0]).toMatchObject({
      documentId: 'doc-1',
      status: 'parsing',
      progress: {
        phase: 'queued',
        message: 'Queued for parsing',
        currentPage: null,
        totalPages: null,
        ocrPageCount: 0,
        updatedAt: '2026-06-19T12:00:00.000Z',
      },
    });

    parseDeferred.resolve(parsed());
    await service.waitForIdleForTests();
    const complete = await service.getOverview();

    expect(complete.documents[0]).toMatchObject({
      documentId: 'doc-1',
      status: 'ready',
      progress: null,
    });
    expect(complete.summary.nodeCount).toBe(1);
  });

  it('persists parser progress and LiteParse diagnostics/parserName from background jobs', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const parseDeferred = deferred<NormalizedParserDocument>();
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async (input) => {
        await input.onProgress?.({
          phase: 'ocr',
          message: 'Running OCR on page 2',
          currentPage: 2,
          totalPages: 5,
          ocrPageCount: 1,
        });
        return parseDeferred.promise;
      },
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    await viWaitFor(() => service.getOverview(), (overview) => overview.documents[0]?.progress?.phase === 'ocr');
    const duringParse = await service.getOverview();

    expect(duringParse.documents[0]).toMatchObject({
      parserName: 'liteparse',
      status: 'ocr',
      progress: {
        phase: 'ocr',
        message: 'Running OCR on page 2',
        currentPage: 2,
        totalPages: 5,
        ocrPageCount: 1,
      },
    });

    parseDeferred.resolve({
      ...parsed('liteparse'),
      diagnostics: ['LiteParse OCR merged for suspicious page'],
      pageDiagnostics: [
        {
          pageNumber: 1,
          extractionMode: 'native_plus_ocr',
          severity: 'info',
          message: 'LiteParse OCR merged for suspicious page',
          reasons: ['low native text density'],
        },
      ],
    });
    await service.waitForIdleForTests();
    const complete = await service.getOverview();

    expect(complete.documents[0]).toMatchObject({
      parserName: 'liteparse',
      status: 'ready',
      progress: null,
    });
    expect(complete.documents[0].diagnostics.map((item) => item.message)).toContain(
      'LiteParse OCR merged for suspicious page'
    );
  });

  it('surfaces OCR page-count diagnostics from the parser', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-20T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => ({
        ...parsed(),
        parserName: 'liteparse',
        diagnostics: ['Parsed 1,642 pages. OCR used on 7 pages.'],
      }),
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    const overview = await service.getOverview();

    expect(overview.diagnostics.map((item) => item.message)).toContain(
      'Parsed 1,642 pages. OCR used on 7 pages.'
    );
  });

  it('marks startup in-progress records interrupted with a recovery diagnostic', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const registryDir = path.join(userData, 'knowledge-base', 'building-code');
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, 'documents.json'),
      `${JSON.stringify(
        {
          version: 1,
          documents: [
            {
              documentId: 'doc-1',
              originalFilename: 'input.md',
              detectedFileType: 'md',
              mimeType: 'text/markdown',
              sourceChecksum: 'checksum',
              sourcePath: path.join(userData, 'input.md'),
              sourceUri: 'kb://building-code/doc-1/input.md',
              parserName: 'liteparse',
              parserVersion: 'unknown',
              status: 'embedding',
              uploadedAt: '2026-06-19T12:00:00.000Z',
              parseStartedAt: '2026-06-19T12:00:00.000Z',
              parseCompletedAt: null,
              lastIndexRebuildAt: null,
              metadata: {
                codeFamily: 'NBC',
                edition: 'unknown',
                jurisdictionScope: 'Canada',
                sourceTitle: 'input',
              },
              diagnostics: [],
              failureMessage: null,
              progress: {
                phase: 'embedding',
                message: 'Embedding chunks',
                currentPage: null,
                totalPages: null,
                ocrPageCount: 0,
                updatedAt: '2026-06-19T12:01:00.000Z',
              },
              indexSummary: {
                nodeCount: 0,
                tableCount: 0,
                chunkCount: 0,
                resolvedReferenceCount: 0,
                unresolvedReferenceCount: 0,
                sectionCount: 0,
                semanticSearchAvailable: false,
              },
            },
            {
              documentId: 'doc-queued',
              originalFilename: 'queued.md',
              detectedFileType: 'md',
              mimeType: 'text/markdown',
              sourceChecksum: 'queued-checksum',
              sourcePath: path.join(userData, 'queued.md'),
              sourceUri: 'kb://building-code/doc-queued/queued.md',
              parserName: 'liteparse',
              parserVersion: 'unknown',
              status: 'queued',
              uploadedAt: '2026-06-19T12:02:00.000Z',
              parseStartedAt: null,
              parseCompletedAt: null,
              lastIndexRebuildAt: null,
              metadata: {
                codeFamily: 'NBC',
                edition: 'unknown',
                jurisdictionScope: 'Canada',
                sourceTitle: 'queued',
              },
              diagnostics: [],
              failureMessage: null,
              progress: null,
              indexSummary: {
                nodeCount: 0,
                tableCount: 0,
                chunkCount: 0,
                resolvedReferenceCount: 0,
                unresolvedReferenceCount: 0,
                sectionCount: 0,
                semanticSearchAvailable: false,
              },
            },
          ],
        },
        null,
        2
      )}\n`
    );
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:05:00.000Z',
      randomId: () => 'doc-2',
      parseDocument: async () => parsed(),
    });

    const overview = await service.getOverview();

    for (const documentId of ['doc-1', 'doc-queued']) {
      const document = overview.documents.find((item) => item.documentId === documentId);
      expect(document).toMatchObject({
        status: 'interrupted',
        progress: null,
        failureMessage: 'Parsing was interrupted when MEP Lab closed.',
      });
      expect(document?.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          phase: 'parse',
          message: 'Parsing was interrupted when MEP Lab closed.',
        })
      );
    }
  });

  it('keeps the prior active index and marks the legacy document failed when rebuild sees persisted Docling parsed data', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    const secondSource = path.join(userData, 'second.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    fs.writeFileSync(secondSource, 'Section 9.11.1.1 Sound control\nBody text.');
    let nextId = 0;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => `doc-${++nextId}`,
      parseDocument: async () => parsed('liteparse'),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    fs.writeFileSync(
      path.join(userData, 'knowledge-base', 'building-code', 'parsed', 'doc-1.json'),
      `${JSON.stringify(
        {
          parserName: 'docling',
          parserVersion: '2.0.0-docling',
          pages: [],
          elements: [],
          tables: [],
          diagnostics: [],
        },
        null,
        2
      )}\n`
    );

    await service.uploadDocuments([secondSource]);
    await service.waitForIdleForTests();
    const after = await service.getOverview();
    const afterIndex = activeIndexSnapshot(userData);

    expect(after.documents.find((document) => document.documentId === 'doc-1')).toMatchObject({
      documentId: 'doc-1',
      status: 'failed',
      failureMessage: 'Legacy Docling parsed data requires LiteParse reparse.',
      progress: null,
    });
    expect(after.documents.find((document) => document.documentId === 'doc-1')?.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        phase: 'canonicalize',
        message: 'Legacy Docling parsed data requires LiteParse reparse.',
      })
    );
    expect(after.documents.find((document) => document.documentId === 'doc-2')).toMatchObject({
      documentId: 'doc-2',
      status: 'failed',
      failureMessage:
        'Building-code index rebuild was blocked by another document failure. Reparse after fixing the failing document.',
      progress: null,
    });
    expect(after.documents.find((document) => document.documentId === 'doc-2')?.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        phase: 'index',
        message:
          'Building-code index rebuild was blocked by another document failure. Reparse after fixing the failing document.',
      })
    );
    expect(after.summary).toEqual(before.summary);
    expect(afterIndex.index.nodes).toEqual(beforeIndex.index.nodes);
    expect(afterIndex.vectors.vectors).toEqual(beforeIndex.vectors.vectors);
  });

  it('reparse returns while queued and preserves the prior active index when its background parse fails', async () => {
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
    await service.waitForIdleForTests();
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    shouldFail = true;
    const immediate = await service.reparseDocument('doc-1');

    expect(immediate.documents[0]).toMatchObject({
      status: 'parsing',
      progress: expect.objectContaining({
        phase: 'queued',
        message: 'Queued for parsing',
      }),
    });

    await service.waitForIdleForTests();
    const after = await service.getOverview();
    const afterIndex = activeIndexSnapshot(userData);

    expect(after.documents[0]).toMatchObject({
      status: 'failed',
      failureMessage: 'parser exploded',
      progress: null,
    });
    expect(after.summary).toMatchObject({
      nodeCount: before.summary.nodeCount,
      semanticSearchAvailable: true,
    });
    expect(afterIndex.index.nodes).toEqual(beforeIndex.index.nodes);
    expect(afterIndex.vectors.vectors).toEqual(beforeIndex.vectors.vectors);
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
    await service.waitForIdleForTests();
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    shouldFail = true;
    await service.uploadDocuments([bad]);
    await service.waitForIdleForTests();
    const after = await service.getOverview();
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
    await service.waitForIdleForTests();
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    shouldFail = true;
    await service.reparseDocument('doc-1');
    await service.waitForIdleForTests();
    const after = await service.getOverview();
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
    await service.waitForIdleForTests();
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    const beforeGoodDocument = before.documents.find((document) => document.documentId === 'doc-1');
    reparsingBadDocument = true;
    await service.reparseDocument('doc-2');
    await service.waitForIdleForTests();
    const after = await service.getOverview();
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
    await service.waitForIdleForTests();
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    failSave = true;
    await service.reparseDocument('doc-1');
    await service.waitForIdleForTests();
    const after = await service.getOverview();
    const afterIndex = activeIndexSnapshot(userData);

    expect(after.summary).toEqual(before.summary);
    expect(after.documents[0]).toMatchObject({
      status: 'failed',
      failureMessage: expect.stringContaining('cannot save index at'),
      progress: null,
    });
    expect(after.documents[0].diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        phase: 'index',
        message: expect.stringContaining('cannot save index at'),
      })
    );
    expect(after.documents[0].indexSummary).toEqual(before.documents[0].indexSummary);
    expect(after.documents[0].lastIndexRebuildAt).toBe(before.documents[0].lastIndexRebuildAt);
    expect(afterIndex.indexFile).toBe(beforeIndex.indexFile);
    expect(afterIndex.vectorFile).toBe(beforeIndex.vectorFile);
  });

  it('does not resurrect or index a document removed while its parse is in flight', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const parseDeferred = deferred<NormalizedParserDocument>();
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => parseDeferred.promise,
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    const removed = await service.removeDocument('doc-1');
    parseDeferred.resolve(parsed());
    await service.waitForIdleForTests();
    const after = await service.getOverview();

    expect(removed.documents[0]).toMatchObject({ documentId: 'doc-1', status: 'removed' });
    expect(after.documents[0]).toMatchObject({ documentId: 'doc-1', status: 'removed' });
    expect(after.summary.nodeCount).toBe(0);
    expect(after.graph.nodes).toEqual([]);
    const afterIndex = activeIndexSnapshot(userData);
    expect(afterIndex.index.nodes).toEqual([]);
  });

  it('serializes reparse behind a concurrent removal so removed documents stay removed', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const saveStarted = deferred<void>();
    const allowSave = deferred<void>();
    let blockRemoveSave = false;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => parsed(),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
      saveIndex: async (indexDir: string, index: BuildingCodeIndex) => {
        if (blockRemoveSave) {
          saveStarted.resolve();
          await allowSave.promise;
        }
        await saveBuildingCodeIndex(indexDir, index);
      },
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    blockRemoveSave = true;
    const removePromise = service.removeDocument('doc-1');
    await saveStarted.promise;
    const reparsePromise = service.reparseDocument('doc-1');
    let reparseSettled = false;
    reparsePromise.catch(() => undefined).finally(() => {
      reparseSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(reparseSettled).toBe(false);

    allowSave.resolve();
    const removed = await removePromise;
    await expect(reparsePromise).rejects.toThrow('Knowledge-base document not found: doc-1');
    const after = await service.getOverview();

    expect(removed.documents[0]).toMatchObject({ documentId: 'doc-1', status: 'removed' });
    expect(after.documents[0]).toMatchObject({ documentId: 'doc-1', status: 'removed' });
    expect(after.summary.nodeCount).toBe(0);
  });

  it('does not let rebuildEmbeddings summary updates clear a newer reparse intent', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const embedStarted = deferred<void>();
    const allowEmbed = deferred<void>();
    const reparseDeferred = deferred<NormalizedParserDocument>();
    let initialUpload = true;
    let blockRebuildEmbedding = false;
    let reparseMode = false;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => (reparseMode ? reparseDeferred.promise : parsed()),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => {
          if (initialUpload) {
            throw new Error('embedding not configured yet');
          }
          if (blockRebuildEmbedding) {
            embedStarted.resolve();
            await allowEmbed.promise;
          }
          return texts.map(() => [1, 0, 0]);
        },
      }),
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    initialUpload = false;
    blockRebuildEmbedding = true;
    const rebuildPromise = service.rebuildEmbeddings();
    await embedStarted.promise;
    reparseMode = true;
    const reparsePromise = service.reparseDocument('doc-1');

    allowEmbed.resolve();
    await rebuildPromise;
    await reparsePromise;
    const after = await service.getOverview();

    expect(after.documents[0]).toMatchObject({
      status: 'parsing',
      progress: expect.objectContaining({ phase: 'queued' }),
    });

    reparseDeferred.resolve(parsed());
    await service.waitForIdleForTests();
  });

  it('does not let an older queued parse job adopt a newer reparse token', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const sourceA = path.join(userData, 'a.md');
    const sourceB = path.join(userData, 'b.md');
    fs.writeFileSync(sourceA, 'Section 9.10.3.1 Fire separations\nBody text.');
    fs.writeFileSync(sourceB, 'Section 9.11.1.1 Sound control\nBody text.');
    const firstParse = deferred<NormalizedParserDocument>();
    let nextId = 0;
    let doc2ParseCalls = 0;
    const times = [
      '2026-06-19T12:00:00.000Z',
      '2026-06-19T12:01:00.000Z',
      '2026-06-19T12:02:00.000Z',
      '2026-06-19T12:03:00.000Z',
      '2026-06-19T12:04:00.000Z',
    ];
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => times.shift() ?? '2026-06-19T12:05:00.000Z',
      randomId: () => `doc-${++nextId}`,
      parseDocument: async (input) => {
        if (input.filePath.includes('doc-1-')) {
          return firstParse.promise;
        }

        doc2ParseCalls += 1;
        return parsed();
      },
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([sourceA, sourceB]);
    await service.reparseDocument('doc-2');
    firstParse.resolve(parsed());
    await service.waitForIdleForTests();
    const after = await service.getOverview();

    expect(doc2ParseCalls).toBe(1);
    expect(after.documents.find((document) => document.documentId === 'doc-2')).toMatchObject({
      status: 'ready',
      parseStartedAt: '2026-06-19T12:04:00.000Z',
    });
  });

  it('ignores stale parser progress after a parse job has completed', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    let progressCallback: ((progress: ParseDocumentProgress) => Promise<void> | void) | undefined;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async (input) => {
        progressCallback = input.onProgress;
        return parsed();
      },
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    const ready = await service.getOverview();
    await progressCallback?.({
      phase: 'ocr',
      message: 'Stale OCR callback',
      currentPage: 1,
      totalPages: 1,
      ocrPageCount: 1,
    });
    const after = await service.getOverview();

    expect(ready.documents[0]).toMatchObject({ status: 'ready', progress: null });
    expect(after.documents[0]).toMatchObject({ status: 'ready', progress: null });
  });

  it('lets a newer reparse supersede an older in-flight parse job result and progress', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const firstParse = deferred<NormalizedParserDocument>();
    const secondParse = deferred<NormalizedParserDocument>();
    let parseCalls = 0;
    const progressCallbacks: Array<(progress: ParseDocumentProgress) => Promise<void> | void> = [];
    const times = [
      '2026-06-19T12:00:00.000Z',
      '2026-06-19T12:01:00.000Z',
      '2026-06-19T12:02:00.000Z',
      '2026-06-19T12:03:00.000Z',
      '2026-06-19T12:04:00.000Z',
      '2026-06-19T12:05:00.000Z',
    ];
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => times.shift() ?? '2026-06-19T12:06:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async (input) => {
        parseCalls += 1;
        if (input.onProgress) {
          progressCallbacks.push(input.onProgress);
        }
        return parseCalls === 1 ? firstParse.promise : secondParse.promise;
      },
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    await viWaitFor(() => Promise.resolve(parseCalls), (count) => count === 1);
    const newerIntent = await service.reparseDocument('doc-1');
    await progressCallbacks[0]?.({
      phase: 'ocr',
      message: 'Stale OCR from old parse',
      currentPage: 1,
      totalPages: 1,
      ocrPageCount: 1,
    });
    const afterStaleProgress = await service.getOverview();
    firstParse.resolve(parsedWithoutCanonicalHeadings());
    await viWaitFor(() => Promise.resolve(parseCalls), (count) => count === 2);
    const whileNewerParsePending = await service.getOverview();
    secondParse.resolve(parsed());
    await service.waitForIdleForTests();
    const after = await service.getOverview();

    expect(newerIntent.documents[0]).toMatchObject({
      status: 'parsing',
      progress: expect.objectContaining({ phase: 'queued' }),
    });
    expect(afterStaleProgress.documents[0]).toMatchObject({
      status: 'parsing',
      progress: expect.objectContaining({ phase: 'queued' }),
    });
    expect(whileNewerParsePending.documents[0]).toMatchObject({
      status: 'parsing',
      progress: expect.objectContaining({ phase: 'queued' }),
    });
    expect(after.documents[0]).toMatchObject({
      status: 'ready',
      parserName: 'fixture',
      progress: null,
    });
    expect(after.summary.nodeCount).toBe(1);
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
    await service.waitForIdleForTests();
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
    await service.waitForIdleForTests();
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
    await service.waitForIdleForTests();
    const before = activeIndexSnapshot(userData);
    expect(before.index.semanticSearchAvailable).toBe(true);
    expect(before.vectors.vectors.length).toBeGreaterThan(0);
    shouldFail = true;
    await service.uploadDocuments([bad]);
    await service.waitForIdleForTests();
    const after = await service.getOverview();
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

  it('rebuildEmbeddings embeds existing chunks without re-parsing documents', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    let embedCalls = 0;
    let shouldEmbed = false;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => parsed(),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts: string[]) => {
          if (!shouldEmbed) {
            throw new Error('embedding not configured yet');
          }
          embedCalls += 1;
          return texts.map(() => [0.1, 0.2, 0.3]);
        },
      }),
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    const before = await service.getOverview();
    expect(before.summary.semanticSearchAvailable).toBe(false);
    expect(before.summary.chunkCount).toBeGreaterThan(0);

    shouldEmbed = true;
    const after = await service.rebuildEmbeddings();

    expect(after.summary.semanticSearchAvailable).toBe(true);
    expect(embedCalls).toBeGreaterThan(0);
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

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    const overview = await service.getOverview();
    process.env.BUILDING_CODE_INDEX_DIR = service.getIndexDir();
    const { handleBuildingCodeTool } = await import('../src/main/mcp/building-code-server');
    const exactResult = await handleBuildingCodeTool('read_section', { ref: 'Section 9.10.3.1' });

    expect(overview.documents[0].status).toBe('ready_with_warnings');
    expect(overview.summary.nodeCount).toBe(1);
    expect(overview.summary.semanticSearchAvailable).toBe(false);
    expect(exactResult.results).toHaveLength(1);
    expect(exactResult.results[0]?.citation.logicalRef).toBe('Section 9.10.3.1');
    const embeddingWarnings = overview.diagnostics.filter((item) =>
      item.message.includes('embedding endpoint down')
    );
    expect(embeddingWarnings).toHaveLength(1);
    expect(embeddingWarnings[0]?.message).toBe(
      'embedding endpoint down Exact lookup remains available; semantic search is unavailable until embeddings succeed.'
    );
  });

  it('preserves exact lookup and reports semantic-only unavailability for OpenRouter embedding failures', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => parsed(),
      embeddingClientFactory: () =>
        createOpenAIEmbeddingClient({
          provider: 'openrouter',
          apiKey: 'sk-or-v1-secret',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'google/gemini-embedding-2',
          timeoutMs: 9000,
          fetch: async () =>
            new Response(JSON.stringify({
              error: {
                message: 'No endpoints found for requested embedding model',
              },
            }), { status: 404, headers: { 'content-type': 'application/json' } }),
        }),
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    const overview = await service.getOverview();
    process.env.BUILDING_CODE_INDEX_DIR = service.getIndexDir();
    const { handleBuildingCodeTool } = await import('../src/main/mcp/building-code-server');
    const exactResult = await handleBuildingCodeTool('read_section', { ref: 'Section 9.10.3.1' });

    expect(overview.documents[0].status).toBe('ready_with_warnings');
    expect(overview.summary.semanticSearchAvailable).toBe(false);
    expect(exactResult.results[0]?.citation.logicalRef).toBe('Section 9.10.3.1');
    expect(overview.diagnostics.map((item) => item.message)).toContain(
      'OpenRouter embeddings request failed with HTTP 404 (provider=openrouter, model=google/gemini-embedding-2, endpoint=openrouter.ai/api/v1/embeddings): No endpoints found for requested embedding model Exact lookup remains available; semantic search is unavailable until embeddings succeed.'
    );
  });

  it('omits removed-document failures from active overview diagnostics', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    const secondSource = path.join(userData, 'second.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    fs.writeFileSync(secondSource, 'Section 9.11.1.1 Sound control\nBody text.');
    let nextId = 0;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => `doc-${++nextId}`,
      parseDocument: async () => parsed('liteparse'),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    fs.writeFileSync(
      path.join(userData, 'knowledge-base', 'building-code', 'parsed', 'doc-1.json'),
      `${JSON.stringify(
        {
          parserName: 'docling',
          parserVersion: '2.0.0-docling',
          pages: [],
          elements: [],
          tables: [],
          diagnostics: [],
        },
        null,
        2
      )}\n`
    );

    await service.uploadDocuments([secondSource]);
    await service.waitForIdleForTests();
    const failed = await service.getOverview();

    expect(failed.diagnostics.map((item) => item.message)).toContain(
      'Legacy Docling parsed data requires LiteParse reparse.'
    );

    const removed = await service.removeDocument('doc-1');

    expect(removed.documents.find((document) => document.documentId === 'doc-1')).toMatchObject({
      status: 'removed',
    });
    expect(removed.diagnostics.map((item) => item.message)).not.toContain(
      'Legacy Docling parsed data requires LiteParse reparse.'
    );
  });

  it('turns invalid persisted parsed JSON into a reparse action item', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    const secondSource = path.join(userData, 'second.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    fs.writeFileSync(secondSource, 'Section 9.11.1.1 Sound control\nBody text.');
    let nextId = 0;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => `doc-${++nextId}`,
      parseDocument: async () => parsed('liteparse'),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    fs.writeFileSync(
      path.join(userData, 'knowledge-base', 'building-code', 'parsed', 'doc-1.json'),
      `${JSON.stringify(
        {
          parserName: 'liteparse',
          parserVersion: '2.0.0',
          pages: {},
          elements: [],
          tables: [],
          diagnostics: [],
          pageDiagnostics: [],
        },
        null,
        2
      )}\n`
    );

    await service.uploadDocuments([secondSource]);
    await service.waitForIdleForTests();
    const overview = await service.getOverview();

    expect(overview.documents.find((document) => document.documentId === 'doc-1')).toMatchObject({
      status: 'failed',
      failureMessage:
        'Stored parsed LiteParse JSON is invalid: Parser returned invalid result: pages must be an array. Reparse the document to regenerate LiteParse output.',
    });
    expect(overview.documents.find((document) => document.documentId === 'doc-1')?.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        phase: 'canonicalize',
        message:
          'Stored parsed LiteParse JSON is invalid: Parser returned invalid result: pages must be an array. Reparse the document to regenerate LiteParse output.',
      })
    );
  });

  it('turns malformed persisted parsed JSON syntax into a reparse action item', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    const secondSource = path.join(userData, 'second.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    fs.writeFileSync(secondSource, 'Section 9.11.1.1 Sound control\nBody text.');
    let nextId = 0;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => `doc-${++nextId}`,
      parseDocument: async () => parsed('liteparse'),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    fs.writeFileSync(
      path.join(userData, 'knowledge-base', 'building-code', 'parsed', 'doc-1.json'),
      '{"parserName":"liteparse"',
      'utf8'
    );

    await service.uploadDocuments([secondSource]);
    await service.waitForIdleForTests();
    const overview = await service.getOverview();
    const failed = overview.documents.find((document) => document.documentId === 'doc-1');

    expect(failed).toMatchObject({
      status: 'failed',
    });
    expect(failed?.failureMessage).toContain('Stored parsed LiteParse JSON is invalid:');
    expect(failed?.failureMessage).toContain(
      'Reparse the document to regenerate LiteParse output.'
    );
    expect(failed?.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        phase: 'canonicalize',
      })
    );
    expect(failed?.diagnostics.some((item) =>
      item.message.includes('Stored parsed LiteParse JSON is invalid:') &&
      item.message.includes('Reparse the document to regenerate LiteParse output.')
    )).toBe(true);
  });

  it('preserves unrelated embedding diagnostics when rebuilding semantic-search warnings', async () => {
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

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    const index = await loadBuildingCodeIndex(service.getIndexDir());
    const semanticWarning =
      'embedding endpoint down Exact lookup remains available; semantic search is unavailable until embeddings succeed.';

    index.diagnostics = ['Custom embedding cache note', semanticWarning];
    await saveBuildingCodeIndex(service.getIndexDir(), index);

    const overview = await service.rebuildEmbeddings();
    const messages = overview.diagnostics.map((item) => item.message);

    expect(messages).toContain('Custom embedding cache note');
    expect(messages.filter((message) => message === semanticWarning)).toHaveLength(1);
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
    await service.waitForIdleForTests();
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

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    const overview = await service.getOverview();

    expect(overview.documents[0]).toMatchObject({
      status: 'failed',
      parseStartedAt: '2026-06-19T12:01:00.000Z',
      parseCompletedAt: '2026-06-19T12:02:00.000Z',
    });
  });

  it('uploads through the service and serves exact MCP reads from the active snapshot', async () => {
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
    await service.waitForIdleForTests();
    process.env.BUILDING_CODE_INDEX_DIR = service.getIndexDir();

    const { handleBuildingCodeTool } = await import('../src/main/mcp/building-code-server');
    const result = await handleBuildingCodeTool('read_section', { ref: 'Section 9.10.3.1' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      excerpt: 'Body text.',
      fullText: 'Body text.',
      citation: {
        logicalRef: 'Section 9.10.3.1',
        sourceUrl: 'kb://building-code/doc-1/input.md',
        displayCitation: 'NBC unknown, Section 9.10.3.1',
      },
    });
    const textResult = JSON.parse(result.content[0]?.text ?? '{}') as typeof result;
    expect(textResult.results).toHaveLength(result.results.length);
    expect(textResult.results[0]).toMatchObject({
      excerpt: result.results[0]?.excerpt,
      fullText: result.results[0]?.fullText,
      citation: {
        sourceUrl: result.results[0]?.citation.sourceUrl,
      },
    });
  });

  it('retains the prior active index when a rebuild candidate fails canonicalization', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    let noHeadings = false;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => (noHeadings ? 'doc-2' : 'doc-1'),
      parseDocument: async () => (noHeadings ? parsedWithoutCanonicalHeadings() : parsed()),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([source]);
    await service.waitForIdleForTests();
    const before = await service.getOverview();
    const beforeIndex = activeIndexSnapshot(userData);
    noHeadings = true;
    const secondSource = path.join(userData, 'second.md');
    fs.writeFileSync(secondSource, 'Plain prose only.');
    await service.uploadDocuments([secondSource]);
    await service.waitForIdleForTests();
    const after = await service.getOverview();
    const afterIndex = activeIndexSnapshot(userData);

    expect(after.documents.find((document) => document.documentId === 'doc-2')).toMatchObject({
      status: 'failed',
      failureMessage: 'no canonical building-code sections found',
    });
    expect(after.documents.find((document) => document.documentId === 'doc-2')?.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        phase: 'canonicalize',
        message: 'no canonical building-code sections found',
      })
    );
    expect(after.documents.find((document) => document.documentId === 'doc-2')?.diagnostics).not.toContainEqual(
      expect.objectContaining({
        severity: 'error',
        phase: 'index',
      })
    );
    expect(after.summary).toEqual(before.summary);
    expect(afterIndex.index.nodes).toEqual(beforeIndex.index.nodes);
    expect(afterIndex.index.semanticSearchAvailable).toBe(beforeIndex.index.semanticSearchAvailable);
    expect(afterIndex.vectors.vectors).toEqual(beforeIndex.vectors.vectors);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
