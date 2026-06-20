import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DocumentRegistry } from './document-registry';
import { parseDocumentWithDocling, type NormalizedDoclingResult } from './docling-parser';
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
import type {
  KnowledgeBaseDiagnostic,
  KnowledgeBaseDocumentMetadata,
  KnowledgeBaseDocumentRecord,
  KnowledgeBaseGraphSummary,
  KnowledgeBaseIndexSummary,
  KnowledgeBaseOverview,
} from '../../../shared/ipc-types';

type ParseDocument = (filePath: string) => Promise<NormalizedDoclingResult>;
type EmbeddingClientFactory = () => BuildingCodeEmbeddingClient;
type SaveIndex = (indexDir: string, index: BuildingCodeIndex) => Promise<void>;
interface RebuildIndexResult {
  overview: KnowledgeBaseOverview;
  index: BuildingCodeIndex;
  committed: boolean;
}

export interface KnowledgeBaseServiceOptions {
  userDataPath: string;
  now?: () => string;
  randomId?: () => string;
  parseDocument?: ParseDocument;
  embeddingClientFactory?: EmbeddingClientFactory;
  saveIndex?: SaveIndex;
}

export class KnowledgeBaseService {
  private readonly paths: KnowledgeBaseStoragePaths;
  private readonly registry: DocumentRegistry;
  private readonly now: () => string;
  private readonly randomId: () => string;
  private readonly parseDocument: ParseDocument;
  private readonly embeddingClientFactory: EmbeddingClientFactory;
  private readonly saveIndex: SaveIndex;

  constructor(options: KnowledgeBaseServiceOptions) {
    this.paths = buildKnowledgeBaseStoragePaths(options.userDataPath);
    this.registry = new DocumentRegistry(this.paths.registryPath);
    this.now = options.now ?? (() => new Date().toISOString());
    this.randomId = options.randomId ?? randomUUID;
    this.parseDocument =
      options.parseDocument ??
      ((filePath) =>
        parseDocumentWithDocling({
          filePath,
          pythonPath: process.env.DOCLING_PYTHON_PATH || process.env.PYTHON || 'python',
        }));
    this.embeddingClientFactory = options.embeddingClientFactory ?? createOpenAIEmbeddingClient;
    this.saveIndex = options.saveIndex ?? saveBuildingCodeIndex;
  }

  getIndexDir(): string {
    return this.paths.indexDir;
  }

  async getOverview(): Promise<KnowledgeBaseOverview> {
    await ensureKnowledgeBaseStorage(this.paths);
    return this.overviewFrom(await this.registry.list(), await this.loadActiveIndexOrEmpty());
  }

  async uploadDocuments(filePaths: string[]): Promise<KnowledgeBaseOverview> {
    await ensureKnowledgeBaseStorage(this.paths);
    let hasIndexableChange = false;

    for (const filePath of filePaths) {
      const record = await this.createQueuedRecord(filePath);
      await this.registry.upsert(record);
      let parseStartedAt: string | null = null;

      try {
        parseStartedAt = this.now();
        await this.registry.upsert({
          ...record,
          status: 'parsing',
          parseStartedAt,
        });
        const parsed = await this.parseDocument(record.sourcePath);
        await this.writeParsedDocument(record.documentId, parsed);
        await this.registry.upsert({
          ...record,
          status: 'embedding',
          parserVersion: parsed.parserVersion,
          parseStartedAt,
          parseCompletedAt: this.now(),
          diagnostics: parsed.diagnostics.map((message) =>
            diagnostic('info', 'parse', message, record.documentId)
          ),
        });
        hasIndexableChange = true;
      } catch (error) {
        await this.registry.upsert({
          ...record,
          status: 'failed',
          parseStartedAt: parseStartedAt ?? record.parseStartedAt ?? this.now(),
          parseCompletedAt: this.now(),
          diagnostics: [diagnostic('error', 'parse', errorMessage(error), record.documentId)],
          failureMessage: errorMessage(error),
        });
      }
    }

    if (!hasIndexableChange) {
      return this.overviewFrom(await this.registry.list(), await this.loadActiveIndexOrEmpty());
    }

    return (await this.rebuildIndex()).overview;
  }

  async reparseDocument(documentId: string): Promise<KnowledgeBaseOverview> {
    await ensureKnowledgeBaseStorage(this.paths);
    const document = await this.registry.get(documentId);

    if (!document || document.status === 'removed') {
      throw new Error(`Knowledge-base document not found: ${documentId}`);
    }

    const parseStartedAt = this.now();
    await this.registry.upsert({
      ...document,
      status: 'parsing',
      parseStartedAt,
      parseCompletedAt: null,
      failureMessage: null,
      diagnostics: [],
    });

    try {
      const parsed = await this.parseDocument(document.sourcePath);
      await this.writeParsedDocument(documentId, parsed);
      await this.registry.upsert({
        ...document,
        status: 'embedding',
        parserVersion: parsed.parserVersion,
        parseStartedAt,
        parseCompletedAt: this.now(),
        failureMessage: null,
        diagnostics: parsed.diagnostics.map((message) =>
          diagnostic('info', 'parse', message, documentId)
        ),
      });
    } catch (error) {
      await this.registry.upsert({
        ...document,
        status: 'failed',
        parseStartedAt,
        parseCompletedAt: this.now(),
        diagnostics: [diagnostic('error', 'parse', errorMessage(error), documentId)],
        failureMessage: errorMessage(error),
      });
      return this.overviewFrom(await this.registry.list(), await this.loadActiveIndexOrEmpty());
    }

    return (await this.rebuildIndex()).overview;
  }

  async removeDocument(documentId: string): Promise<KnowledgeBaseOverview> {
    await ensureKnowledgeBaseStorage(this.paths);
    const document = await this.registry.get(documentId);

    if (!document || document.status === 'removed') {
      throw new Error(`Knowledge-base document not found: ${documentId}`);
    }

    await this.registry.markRemoved(documentId, this.now());
    const rebuilt = await this.rebuildIndex();

    if (!rebuilt.committed) {
      await this.registry.upsert(document);
      return this.overviewFrom(await this.registry.list(), rebuilt.index);
    }

    return rebuilt.overview;
  }

  private async rebuildIndex(): Promise<RebuildIndexResult> {
    await ensureKnowledgeBaseStorage(this.paths);
    const documents = await this.registry.list();
    const activeDocuments = documents.filter((document) =>
      document.status === 'ready' ||
      document.status === 'ready_with_warnings' ||
      document.status === 'embedding'
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
        });
      }
    }

    if (failedDocumentIds.size > 0) {
      return {
        overview: this.overviewFrom(await this.registry.list(), previousIndex),
        index: previousIndex,
        committed: false,
      };
    }

    let embeddingWarning: KnowledgeBaseDiagnostic | null = null;
    try {
      if (nextIndex.chunks.length > 0) {
        await embedMissingChunks(nextIndex, this.embeddingClientFactory());
      }
      nextIndex.semanticSearchAvailable = nextIndex.vectors.length > 0;
    } catch (error) {
      embeddingWarning = diagnostic('warning', 'embedding', errorMessage(error));
      nextIndex.vectors = [];
      nextIndex.semanticSearchAvailable = false;
    }

    nextIndex.diagnostics.push(
      ...rebuildDiagnostics.map((item) => item.message),
      ...(embeddingWarning ? [embeddingWarning.message] : [])
    );
    try {
      await this.saveIndex(this.paths.indexDir, nextIndex);
    } catch {
      return {
        overview: this.overviewFrom(await this.registry.list(), previousIndex),
        index: previousIndex,
        committed: false,
      };
    }

    await this.updateDocumentSummaries(nextIndex, failedDocumentIds, embeddingWarning);

    return {
      overview: this.overviewFrom(await this.registry.list(), nextIndex),
      index: nextIndex,
      committed: true,
    };
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
      parserName: 'docling',
      parserVersion: 'unknown',
      status: 'queued',
      uploadedAt: this.now(),
      parseStartedAt: null,
      parseCompletedAt: null,
      lastIndexRebuildAt: null,
      metadata: inferMetadata(originalFilename),
      diagnostics: [],
      failureMessage: null,
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
    const documentDiagnostics = documents.flatMap((document) => document.diagnostics);
    const indexDiagnostics = index.diagnostics.map((message) => diagnostic('warning', 'index', message));

    return {
      storageRoot: this.paths.root,
      activeIndexDir: this.paths.indexDir,
      documents,
      summary: summaryFromIndex(index),
      diagnostics: [...documentDiagnostics, ...indexDiagnostics],
      graph: graphFromIndex(index),
    };
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
        lastIndexRebuildAt: nowIso,
        indexSummary: summaryFromIndex(documentIndex),
      });
    }
  }

  private parsedPath(documentId: string): string {
    return path.join(this.paths.parsedDir, `${documentId}.json`);
  }

  private async writeParsedDocument(
    documentId: string,
    parsed: NormalizedDoclingResult
  ): Promise<void> {
    await fs.writeFile(this.parsedPath(documentId), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  }

  private async loadParsedDocument(documentId: string): Promise<NormalizedDoclingResult> {
    return JSON.parse(await fs.readFile(this.parsedPath(documentId), 'utf8')) as NormalizedDoclingResult;
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
      logicalRef: node.logicalRef,
      title: node.title,
      nodeType: node.nodeType,
    })),
    edges: index.crossReferences.map((reference) => ({
      fromNodeId: reference.fromNodeId,
      targetNodeId: reference.targetNodeId,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
