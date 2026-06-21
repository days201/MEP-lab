import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DocumentRegistry } from './document-registry';
import {
  createOpenAIEmbeddingClient,
  embedMissingChunks,
  type BuildingCodeEmbeddingClient,
} from './embedding';
import { ingestParsedBuildingCodeDocument } from './ingest';
import {
  createEmptyBuildingCodeIndex,
  loadBuildingCodeIndex,
  saveBuildingCodeIndex,
  type BuildingCodeIndex,
} from './index-store';
import {
  assertSupportedKnowledgeBaseFile,
  buildKnowledgeBaseStoragePaths,
  checksumFile,
  createKnowledgeBaseSourceUri,
  ensureKnowledgeBaseStorage,
  type KnowledgeBaseStoragePaths,
} from './storage';
import { parseDocumentWithLiteParse } from './liteparse-adapter';
import { ParseJobRunner } from './parse-job-runner';
import type {
  NormalizedParserDocument,
  ParseDocument,
  ParseDocumentProgress,
} from './parser-adapter';
import { normalizeParserDocument } from './parser-adapter';
import type {
  KnowledgeBaseDiagnostic,
  KnowledgeBaseDocumentMetadata,
  KnowledgeBaseDocumentRecord,
  KnowledgeBaseGraphSummary,
  KnowledgeBaseIndexSummary,
  KnowledgeBaseOverview,
  KnowledgeBaseParseProgress,
} from '../../../shared/ipc-types';

type EmbeddingClientFactory = () => BuildingCodeEmbeddingClient;
type SaveIndex = (indexDir: string, index: BuildingCodeIndex) => Promise<void>;
interface RebuildIndexResult {
  overview: KnowledgeBaseOverview;
  index: BuildingCodeIndex;
  committed: boolean;
  failureDiagnostic?: KnowledgeBaseDiagnostic;
}

export interface KnowledgeBaseServiceOptions {
  userDataPath: string;
  now?: () => string;
  randomId?: () => string;
  parseDocument?: ParseDocument;
  runJobsInlineForTests?: boolean;
  embeddingClientFactory?: EmbeddingClientFactory;
  saveIndex?: SaveIndex;
}

export class KnowledgeBaseService {
  private readonly paths: KnowledgeBaseStoragePaths;
  private readonly registry: DocumentRegistry;
  private readonly now: () => string;
  private readonly randomId: () => string;
  private readonly parseDocument: ParseDocument;
  private readonly jobRunner: ParseJobRunner;
  private readonly runJobsInlineForTests: boolean;
  private readonly embeddingClientFactory: EmbeddingClientFactory;
  private readonly saveIndex: SaveIndex;
  private recoveredInterruptedParsingJobs = false;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: KnowledgeBaseServiceOptions) {
    this.paths = buildKnowledgeBaseStoragePaths(options.userDataPath);
    this.registry = new DocumentRegistry(this.paths.registryPath);
    this.now = options.now ?? (() => new Date().toISOString());
    this.randomId = options.randomId ?? randomUUID;
    this.parseDocument = options.parseDocument ?? ((input) => parseDocumentWithLiteParse(input));
    this.jobRunner = new ParseJobRunner();
    this.runJobsInlineForTests = options.runJobsInlineForTests ?? false;
    this.embeddingClientFactory = options.embeddingClientFactory ?? createOpenAIEmbeddingClient;
    this.saveIndex = options.saveIndex ?? saveBuildingCodeIndex;
  }

  getIndexDir(): string {
    return this.paths.indexDir;
  }

  async getOverview(): Promise<KnowledgeBaseOverview> {
    await ensureKnowledgeBaseStorage(this.paths);
    await this.recoverInterruptedParsingJobsOnce();
    return this.overviewFrom(await this.registry.list(), await this.loadActiveIndexOrEmpty());
  }

  async uploadDocuments(filePaths: string[]): Promise<KnowledgeBaseOverview> {
    await ensureKnowledgeBaseStorage(this.paths);
    await this.recoverInterruptedParsingJobsOnce();

    for (const filePath of filePaths) {
      const record = await this.createQueuedRecord(filePath);
      const parseStartedAt = this.nextParseStartedAt(record.parseStartedAt);
      await this.registry.upsert({
        ...record,
        status: 'parsing',
        parseStartedAt,
        progress: this.progress('queued', 'Queued for parsing', null, null, 0, parseStartedAt),
      });
      const parseJob = this.enqueueParseJob(record.documentId, parseStartedAt);
      if (this.runJobsInlineForTests) {
        await parseJob;
      }
    }

    return this.overviewFrom(await this.registry.list(), await this.loadActiveIndexOrEmpty());
  }

  async reparseDocument(documentId: string): Promise<KnowledgeBaseOverview> {
    await ensureKnowledgeBaseStorage(this.paths);
    await this.recoverInterruptedParsingJobsOnce();
    let parseJob: Promise<void> | null = null;
    const overview = await this.withMutationLock(async () => {
      const document = await this.registry.get(documentId);

      if (!document || document.status === 'removed') {
        throw new Error(`Knowledge-base document not found: ${documentId}`);
      }

      const parseStartedAt = this.nextParseStartedAt(document.parseStartedAt);
      await this.registry.upsert({
        ...document,
        status: 'parsing',
        parseStartedAt,
        parseCompletedAt: null,
        failureMessage: null,
        diagnostics: [],
        progress: this.progress('queued', 'Queued for parsing', null, null, 0, parseStartedAt),
      });
      parseJob = this.enqueueParseJob(documentId, parseStartedAt);

      return this.overviewFrom(await this.registry.list(), await this.loadActiveIndexOrEmpty());
    });

    if (this.runJobsInlineForTests) {
      await parseJob;
    }

    return overview;
  }

  async rebuildEmbeddings(): Promise<KnowledgeBaseOverview> {
    await ensureKnowledgeBaseStorage(this.paths);
    await this.recoverInterruptedParsingJobsOnce();
    return this.withMutationLock(async () => {
      const index = await this.loadActiveIndexOrEmpty();
      let embeddingWarning: KnowledgeBaseDiagnostic | null = null;

      if (index.chunks.length === 0) {
        return this.overviewFrom(await this.registry.list(), index);
      }

      try {
        await embedMissingChunks(index, this.embeddingClientFactory());
        index.semanticSearchAvailable = index.vectors.length > 0;
      } catch (error) {
        embeddingWarning = diagnostic('warning', 'embedding', semanticSearchWarning(errorMessage(error)));
        index.vectors = [];
        index.semanticSearchAvailable = false;
      }

      if (embeddingWarning) {
        index.diagnostics = mergeUniqueMessages(
          index.diagnostics.filter((message) => !isSemanticSearchWarning(message)),
          [embeddingWarning.message]
        );
      }

      await this.saveIndex(this.paths.indexDir, index);
      await this.updateDocumentSummaries(index, new Set(), embeddingWarning);
      return this.overviewFrom(await this.registry.list(), index);
    });
  }

  async removeDocument(documentId: string): Promise<KnowledgeBaseOverview> {
    await ensureKnowledgeBaseStorage(this.paths);
    await this.recoverInterruptedParsingJobsOnce();
    const document = await this.registry.get(documentId);

    if (!document || document.status === 'removed') {
      throw new Error(`Knowledge-base document not found: ${documentId}`);
    }

    return this.withMutationLock(async () => {
      const registryBeforeRemoval = await this.registry.list();
      await this.registry.markRemoved(documentId, this.now());
      const rebuilt = await this.rebuildIndex();

      if (!rebuilt.committed) {
        for (const record of registryBeforeRemoval) {
          await this.registry.upsert(record);
        }
        return this.overviewFrom(await this.registry.list(), rebuilt.index);
      }

      return rebuilt.overview;
    });
  }

  async waitForIdleForTests(): Promise<void> {
    await this.jobRunner.waitForIdle();
  }

  private enqueueParseJob(documentId: string, parseStartedAt: string): Promise<void> {
    const job = this.jobRunner.enqueue(() => this.runParseJob(documentId, parseStartedAt));

    if (!this.runJobsInlineForTests) {
      void job;
    }

    return job;
  }

  private async runParseJob(documentId: string, parseStartedAt: string): Promise<void> {
    const document = await this.currentParseJobDocument(documentId, parseStartedAt, [
      'queued',
      'parsing',
      'ocr',
    ]);

    if (!document) {
      return;
    }

    try {
      const parsed = await this.parseDocument({
        filePath: document.sourcePath,
        onProgress: (progress) => this.persistParserProgress(documentId, parseStartedAt, progress),
      });
      await this.withMutationLock(async () => {
        const current = await this.currentParseJobDocument(documentId, parseStartedAt, [
          'queued',
          'parsing',
          'ocr',
        ]);

        if (!current) {
          return;
        }

        await this.writeParsedDocument(documentId, parsed);
        const parseDiagnostics = parsed.diagnostics.map((message) =>
          diagnostic('info', 'parse', message, documentId)
        );
        await this.registry.upsert({
          ...current,
          status: 'canonicalizing',
          parserName: parsed.parserName,
          parserVersion: parsed.parserVersion,
          parseStartedAt,
          parseCompletedAt: this.now(),
          diagnostics: parseDiagnostics,
          failureMessage: null,
          progress: this.progress('canonicalizing', 'Canonicalizing parsed document'),
        });
        const canonicalizing = await this.currentParseJobDocument(documentId, parseStartedAt, [
          'canonicalizing',
        ]);

        if (!canonicalizing) {
          return;
        }

        await this.registry.upsert({
          ...canonicalizing,
          status: 'embedding',
          progress: this.progress('embedding', 'Embedding parsed document chunks'),
        });
        const rebuilt = await this.rebuildIndex();

        if (!rebuilt.committed) {
          return;
        }
      });
    } catch (error) {
      await this.withMutationLock(async () => {
        await this.failCurrentParseJob(
          documentId,
          parseStartedAt,
          diagnostic('error', 'parse', errorMessage(error), documentId)
        );
      });
    }
  }

  private async persistParserProgress(
    documentId: string,
    parseStartedAt: string,
    parserProgress: ParseDocumentProgress
  ): Promise<void> {
    await this.withMutationLock(async () => {
      const document = await this.currentParseJobDocument(documentId, parseStartedAt, [
        'queued',
        'parsing',
        'ocr',
      ]);

      if (!document || isProgressRegression(document.progress?.phase, parserProgress.phase)) {
        return;
      }

      const status = parserProgress.phase === 'queued' ? 'parsing' : parserProgress.phase;
      await this.registry.upsert({
        ...document,
        status,
        progress: this.progress(
          parserProgress.phase,
          parserProgress.message,
          parserProgress.currentPage,
          parserProgress.totalPages,
          parserProgress.ocrPageCount
        ),
      });
    });
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async rebuildIndex(): Promise<RebuildIndexResult> {
    await ensureKnowledgeBaseStorage(this.paths);
    const documents = await this.registry.list();
    const activeDocuments = documents.filter((document) =>
      document.status === 'ready' ||
      document.status === 'ready_with_warnings' ||
      document.status === 'embedding' ||
      document.status === 'canonicalizing'
    );
    const previousIndex = await this.loadActiveIndexOrEmpty();
    const nextIndex = createEmptyBuildingCodeIndex();
    const failedDocumentIds = new Set<string>();
    const rebuildDiagnostics: KnowledgeBaseDiagnostic[] = [];

    for (const document of activeDocuments) {
      try {
        const parsed = await this.loadParsedDocument(document.documentId);
        const ingested = ingestParsedBuildingCodeDocument(parsed, {
          ...document,
          parserVersion: parsed.parserVersion,
        });

        nextIndex.sources.push(...ingested.sources);
        nextIndex.pages.push(...ingested.pages);
        nextIndex.nodes.push(...ingested.nodes);
        nextIndex.chunks.push(...ingested.chunks);
        nextIndex.tables.push(...ingested.tables);
        nextIndex.crossReferences.push(...ingested.crossReferences);
        nextIndex.diagnostics.push(...ingested.diagnostics);
      } catch (error) {
        const item = diagnostic('error', 'canonicalize', errorMessage(error), document.documentId);
        failedDocumentIds.add(document.documentId);
        rebuildDiagnostics.push(item);
        await this.registry.upsert({
          ...document,
          status: 'failed',
          diagnostics: [...document.diagnostics, item],
          failureMessage: errorMessage(error),
          lastIndexRebuildAt: this.now(),
          progress: null,
        });
      }
    }

    if (failedDocumentIds.size > 0) {
      const blockedRebuildMessage =
        'Building-code index rebuild was blocked by another document failure. Reparse after fixing the failing document.';

      for (const document of activeDocuments) {
        if (
          failedDocumentIds.has(document.documentId) ||
          (document.status !== 'embedding' && document.status !== 'canonicalizing')
        ) {
          continue;
        }

        const item = diagnostic('error', 'index', blockedRebuildMessage, document.documentId);
        await this.registry.upsert({
          ...document,
          status: 'failed',
          diagnostics: [...document.diagnostics, item],
          failureMessage: blockedRebuildMessage,
          lastIndexRebuildAt: this.now(),
          progress: null,
        });
      }

      return {
        overview: this.overviewFrom(await this.registry.list(), previousIndex),
        index: previousIndex,
        committed: false,
        failureDiagnostic: rebuildDiagnostics[0],
      };
    }

    let embeddingWarning: KnowledgeBaseDiagnostic | null = null;
    try {
      if (nextIndex.chunks.length > 0) {
        await embedMissingChunks(nextIndex, this.embeddingClientFactory());
      }
      nextIndex.semanticSearchAvailable = nextIndex.vectors.length > 0;
    } catch (error) {
      embeddingWarning = diagnostic('warning', 'embedding', semanticSearchWarning(errorMessage(error)));
      nextIndex.vectors = [];
      nextIndex.semanticSearchAvailable = false;
    }

    nextIndex.diagnostics = mergeUniqueMessages(
      nextIndex.diagnostics,
      rebuildDiagnostics.map((item) => item.message),
      ...(embeddingWarning ? [[embeddingWarning.message]] : [])
    );
    try {
      await this.saveIndex(this.paths.indexDir, nextIndex);
    } catch (error) {
      const item = diagnostic('error', 'index', errorMessage(error));

      for (const document of activeDocuments) {
        if (document.status !== 'embedding' && document.status !== 'canonicalizing') {
          continue;
        }

        await this.registry.upsert({
          ...document,
          status: 'failed',
          diagnostics: [...document.diagnostics, { ...item, documentId: document.documentId }],
          failureMessage: item.message,
          progress: null,
        });
      }

      return {
        overview: this.overviewFrom(await this.registry.list(), previousIndex),
        index: previousIndex,
        committed: false,
        failureDiagnostic: item,
      };
    }

    await this.updateDocumentSummaries(nextIndex, failedDocumentIds, embeddingWarning);

    return {
      overview: this.overviewFrom(await this.registry.list(), nextIndex),
      index: nextIndex,
      committed: true,
    };
  }

  private async recoverInterruptedParsingJobsOnce(): Promise<void> {
    if (this.recoveredInterruptedParsingJobs) {
      return;
    }

    this.recoveredInterruptedParsingJobs = true;
    const interruptedStatuses = new Set(['queued', 'parsing', 'ocr', 'canonicalizing', 'embedding']);
    const message = 'Parsing was interrupted when MEP Lab closed.';
    const documents = await this.registry.list();

    for (const document of documents) {
      if (!interruptedStatuses.has(document.status)) {
        continue;
      }

      await this.registry.upsert({
        ...document,
        status: 'interrupted',
        progress: null,
        failureMessage: message,
        diagnostics: [...document.diagnostics, diagnostic('warning', 'parse', message, document.documentId)],
      });
    }
  }

  private async createQueuedRecord(filePath: string): Promise<KnowledgeBaseDocumentRecord> {
    const detectedFileType = assertSupportedKnowledgeBaseFile(filePath);
    const documentId = this.randomId();
    const originalFilename = path.basename(filePath);
    const storedFilename = `${documentId}-${originalFilename}`;
    const sourcePath = path.join(this.paths.sourcesDir, storedFilename);
    const sourceChecksum = await checksumFile(filePath);

    await fs.copyFile(filePath, sourcePath);

    return {
      documentId,
      originalFilename,
      detectedFileType,
      mimeType: mimeTypeFor(detectedFileType),
      sourceChecksum,
      sourcePath,
      sourceUri: createKnowledgeBaseSourceUri(documentId, originalFilename),
      parserName: 'liteparse',
      parserVersion: 'unknown',
      status: 'queued',
      uploadedAt: this.now(),
      parseStartedAt: null,
      parseCompletedAt: null,
      lastIndexRebuildAt: null,
      metadata: inferMetadata(originalFilename),
      diagnostics: [],
      failureMessage: null,
      progress: null,
      indexSummary: emptySummary(),
    };
  }

  private async loadActiveIndexOrEmpty(): Promise<BuildingCodeIndex> {
    try {
      return await loadBuildingCodeIndex(this.paths.indexDir);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return createEmptyBuildingCodeIndex();
      }

      throw error;
    }
  }

  private overviewFrom(
    documents: KnowledgeBaseDocumentRecord[],
    index: BuildingCodeIndex
  ): KnowledgeBaseOverview {
    const documentDiagnostics = documents
      .filter((document) => document.status !== 'removed')
      .flatMap((document) => document.diagnostics);
    const indexDiagnostics = index.diagnostics.map((message) => diagnostic('warning', 'index', message));

    return {
      storageRoot: this.paths.root,
      activeIndexDir: this.paths.indexDir,
      documents,
      summary: summaryFromIndex(index),
      diagnostics: dedupeOverviewDiagnostics([...documentDiagnostics, ...indexDiagnostics]),
      graph: graphFromIndex(index),
    };
  }

  private progress(
    phase: KnowledgeBaseParseProgress['phase'],
    message: string,
    currentPage: number | null = null,
    totalPages: number | null = null,
    ocrPageCount = 0,
    updatedAt = this.now()
  ): KnowledgeBaseParseProgress {
    return {
      phase,
      message,
      currentPage,
      totalPages,
      ocrPageCount,
      updatedAt,
    };
  }

  private nextParseStartedAt(previousParseStartedAt: string | null): string {
    const next = this.now();

    if (!previousParseStartedAt || next !== previousParseStartedAt) {
      return next;
    }

    const previousTime = Date.parse(previousParseStartedAt);
    if (Number.isNaN(previousTime)) {
      return next;
    }

    return new Date(previousTime + 1).toISOString();
  }

  private async updateDocumentSummaries(
    index: BuildingCodeIndex,
    failedDocumentIds: Set<string>,
    embeddingWarning: KnowledgeBaseDiagnostic | null
  ): Promise<void> {
    const nowIso = this.now();
    const documents = await this.registry.list();

    for (const document of documents) {
      if (
        document.status === 'removed' ||
        document.status === 'failed' ||
        isActivePreEmbeddingStatus(document.status) ||
        failedDocumentIds.has(document.documentId)
      ) {
        continue;
      }

      const documentIndex = indexForDocument(index, document.documentId);
      const indexed = documentIndex.sources.length > 0;
      if (!indexed && document.status !== 'embedding') {
        continue;
      }

      await this.registry.upsert({
        ...document,
        status: embeddingWarning ? 'ready_with_warnings' : 'ready',
        diagnostics: embeddingWarning
          ? [...document.diagnostics.filter((item) => item.phase !== 'embedding'), embeddingWarning]
          : document.diagnostics.filter((item) => item.phase !== 'embedding'),
        failureMessage: null,
        progress: null,
        lastIndexRebuildAt: nowIso,
        indexSummary: summaryFromIndex(documentIndex),
      });
    }
  }

  private async currentParseJobDocument(
    documentId: string,
    parseStartedAt: string,
    allowedStatuses: KnowledgeBaseDocumentRecord['status'][]
  ): Promise<KnowledgeBaseDocumentRecord | null> {
    const current = await this.registry.get(documentId);

    if (
      !current ||
      current.status === 'removed' ||
      current.parseStartedAt !== parseStartedAt ||
      !allowedStatuses.includes(current.status)
    ) {
      return null;
    }

    return current;
  }

  private async failCurrentParseJob(
    documentId: string,
    parseStartedAt: string,
    item: KnowledgeBaseDiagnostic
  ): Promise<void> {
    const current = await this.registry.get(documentId);

    if (!current || current.status === 'removed' || current.parseStartedAt !== parseStartedAt) {
      return;
    }

    if (current.status === 'failed') {
      return;
    }

    const failureMessage = item.message;
    await this.registry.upsert({
      ...current,
      status: 'failed',
      parseStartedAt,
      parseCompletedAt: current.parseCompletedAt ?? this.now(),
      diagnostics: [...current.diagnostics, { ...item, documentId: item.documentId ?? documentId }],
      failureMessage,
      progress: null,
    });
  }

  private parsedPath(documentId: string): string {
    return path.join(this.paths.parsedDir, `${documentId}.json`);
  }

  private async writeParsedDocument(
    documentId: string,
    parsed: NormalizedParserDocument
  ): Promise<void> {
    await fs.writeFile(this.parsedPath(documentId), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  }

  private async loadParsedDocument(documentId: string): Promise<NormalizedParserDocument> {
    try {
      const raw = JSON.parse(await fs.readFile(this.parsedPath(documentId), 'utf8')) as { parserName?: unknown };

      if (raw && typeof raw === 'object' && raw.parserName === 'docling') {
        throw new Error('Legacy Docling parsed data requires LiteParse reparse.');
      }

      return normalizeParserDocument(raw);
    } catch (error) {
      if (errorMessage(error) === 'Legacy Docling parsed data requires LiteParse reparse.') {
        throw error;
      }

      throw new Error(
        `Stored parsed LiteParse JSON is invalid: ${errorMessage(error)}. Reparse the document to regenerate LiteParse output.`
      );
    }
  }
}

function emptySummary(): KnowledgeBaseIndexSummary {
  return {
    nodeCount: 0,
    tableCount: 0,
    chunkCount: 0,
    resolvedReferenceCount: 0,
    unresolvedReferenceCount: 0,
    sectionCount: 0,
    semanticSearchAvailable: false,
  };
}

function summaryFromIndex(index: Pick<
  BuildingCodeIndex,
  'nodes' | 'tables' | 'chunks' | 'crossReferences' | 'semanticSearchAvailable'
>): KnowledgeBaseIndexSummary {
  return {
    nodeCount: index.nodes.length,
    tableCount: index.tables.length,
    chunkCount: index.chunks.length,
    resolvedReferenceCount: index.crossReferences.filter((reference) => reference.status === 'resolved').length,
    unresolvedReferenceCount: index.crossReferences.filter((reference) => reference.status === 'unresolved').length,
    sectionCount: index.nodes.filter((node) => node.nodeType === 'section' || node.nodeType === 'subsection').length,
    semanticSearchAvailable: index.semanticSearchAvailable,
  };
}

function graphFromIndex(index: BuildingCodeIndex): KnowledgeBaseGraphSummary {
  return {
    sectionCount: index.nodes.filter((node) => node.nodeType === 'section' || node.nodeType === 'subsection').length,
    tableCount: index.tables.length,
    referenceEdgeCount: index.crossReferences.length,
    unresolvedReferenceCount: index.crossReferences.filter((reference) => reference.status === 'unresolved').length,
    nodes: index.nodes.map((node) => ({
      nodeId: node.nodeId,
      documentId: node.documentId,
      logicalRef: node.logicalRef,
      title: node.title,
      nodeType: node.nodeType,
    })),
    edges: index.crossReferences.map((reference) => ({
      fromNodeId: reference.fromNodeId,
      targetNodeId: reference.targetNodeId,
      targetLogicalRef: reference.targetLogicalRef,
      rawText: reference.rawText,
      status: reference.status,
    })),
  };
}

function diagnostic(
  severity: KnowledgeBaseDiagnostic['severity'],
  phase: KnowledgeBaseDiagnostic['phase'],
  message: string,
  documentId?: string
): KnowledgeBaseDiagnostic {
  return {
    severity,
    phase,
    message,
    ...(documentId ? { documentId } : {}),
  };
}

function inferMetadata(filename: string): KnowledgeBaseDocumentMetadata {
  const title = path.basename(filename, path.extname(filename));
  const upper = title.toUpperCase();

  return {
    codeFamily: upper.includes('OBC') ? 'OBC' : 'NBC',
    edition: upper.match(/\b(19|20)\d{2}\b/)?.[0] ?? 'unknown',
    jurisdictionScope: upper.includes('ONTARIO') || upper.includes('OBC') ? 'Ontario' : 'Canada',
    sourceTitle: title,
  };
}

function mimeTypeFor(fileType: string): string {
  switch (fileType) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc':
      return 'application/msword';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'csv':
      return 'text/csv';
    case 'md':
      return 'text/markdown';
    case 'txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

function indexForDocument(index: BuildingCodeIndex, documentId: string): BuildingCodeIndex {
  const sourceIds = new Set(
    index.sources.filter((source) => source.documentId === documentId).map((source) => source.sourceId)
  );
  const nodeIds = new Set(
    index.nodes.filter((node) => node.documentId === documentId).map((node) => node.nodeId)
  );
  const chunkIds = new Set(
    index.chunks.filter((chunk) => nodeIds.has(chunk.nodeId)).map((chunk) => chunk.chunkId)
  );

  return {
    ...index,
    sources: index.sources.filter((source) => source.documentId === documentId),
    pages: sourceIds.size > 0 ? index.pages : [],
    nodes: index.nodes.filter((node) => node.documentId === documentId),
    chunks: index.chunks.filter((chunk) => chunkIds.has(chunk.chunkId)),
    vectors: index.vectors.filter((vector) => chunkIds.has(vector.chunkId)),
    tables: index.tables.filter((table) => nodeIds.has(table.nodeId)),
    crossReferences: index.crossReferences.filter((reference) => nodeIds.has(reference.fromNodeId)),
  };
}

function isProgressRegression(
  currentPhase: KnowledgeBaseParseProgress['phase'] | undefined,
  nextPhase: KnowledgeBaseParseProgress['phase']
): boolean {
  if (!currentPhase) {
    return false;
  }

  return progressPhaseRank(nextPhase) < progressPhaseRank(currentPhase);
}

function isActivePreEmbeddingStatus(status: KnowledgeBaseDocumentRecord['status']): boolean {
  return status === 'queued' || status === 'parsing' || status === 'ocr' || status === 'canonicalizing';
}

function progressPhaseRank(phase: KnowledgeBaseParseProgress['phase']): number {
  switch (phase) {
    case 'queued':
      return 0;
    case 'parsing':
      return 1;
    case 'ocr':
      return 2;
    case 'canonicalizing':
      return 3;
    case 'embedding':
      return 4;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function semanticSearchWarning(message: string): string {
  return `${message} Exact lookup remains available; semantic search is unavailable until embeddings succeed.`;
}

function isSemanticSearchWarning(message: string): boolean {
  return message.endsWith(
    ' Exact lookup remains available; semantic search is unavailable until embeddings succeed.'
  );
}

function mergeUniqueMessages(...messageLists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const messages of messageLists) {
    for (const message of messages) {
      if (seen.has(message)) {
        continue;
      }
      seen.add(message);
      merged.push(message);
    }
  }

  return merged;
}

function dedupeOverviewDiagnostics(diagnostics: KnowledgeBaseDiagnostic[]): KnowledgeBaseDiagnostic[] {
  const seen = new Set<string>();
  const deduped: KnowledgeBaseDiagnostic[] = [];

  for (const item of diagnostics) {
    const key =
      (item.phase === 'embedding' || item.phase === 'index') && !item.documentId
        ? `${item.severity}:${item.message}`
        : `${item.severity}:${item.phase}:${item.documentId ?? ''}:${item.message}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
