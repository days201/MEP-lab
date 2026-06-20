import fs from 'node:fs/promises';
import path from 'node:path';
import type { PageText } from './pdf-extract';
import type {
  CodeChunkRecord,
  CodeCitation,
  CodeCrossReferenceRecord,
  CodeLayoutBox,
  CodeParserProvenance,
  CodeNodeRecord,
  CodeSourceRecord,
  CodeTableRecord,
  CodeVectorRecord,
} from './types';

export interface BuildingCodeIndex {
  version: 1;
  sources: CodeSourceRecord[];
  pages: PageText[];
  nodes: CodeNodeRecord[];
  chunks: CodeChunkRecord[];
  vectors: CodeVectorRecord[];
  tables: CodeTableRecord[];
  crossReferences: CodeCrossReferenceRecord[];
  diagnostics: string[];
  semanticSearchAvailable: boolean;
}

type BuildingCodeIndexFile = Omit<BuildingCodeIndex, 'vectors'>;

const supportedVersion = 1;

export interface SaveBuildingCodeIndexOptions {
  afterIndexFilePromoted?: () => Promise<void> | void;
}

export function createEmptyBuildingCodeIndex(diagnostics: string[] = []): BuildingCodeIndex {
  return {
    version: supportedVersion,
    sources: [],
    pages: [],
    nodes: [],
    chunks: [],
    vectors: [],
    tables: [],
    crossReferences: [],
    diagnostics,
    semanticSearchAvailable: false,
  };
}

export function isBuildingCodeIndexEmpty(index: Pick<BuildingCodeIndex, 'sources' | 'nodes'>): boolean {
  return index.sources.length === 0 || index.nodes.length === 0;
}

export async function loadBuildingCodeIndex(indexDir: string): Promise<BuildingCodeIndex> {
  const indexPath = path.join(indexDir, 'index.json');
  const vectorPath = path.join(indexDir, 'vectors.json');
  const indexFile = JSON.parse(await fs.readFile(indexPath, 'utf8')) as Partial<BuildingCodeIndexFile>;
  const vectorFile = JSON.parse(await fs.readFile(vectorPath, 'utf8')) as {
    version?: number;
    vectors?: CodeVectorRecord[];
  };

  assertSupportedVersion(indexFile.version);
  assertSupportedVersion(vectorFile.version);

  const sources = arrayOrEmpty(indexFile.sources).map(normalizeCodeSourceRecord);
  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  const nodes = arrayOrEmpty(indexFile.nodes).map((node) =>
    normalizeCodeNodeRecord(node, sourceById.get(node.sourceId))
  );
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));

  return {
    version: supportedVersion,
    sources,
    pages: arrayOrEmpty(indexFile.pages),
    nodes,
    chunks: arrayOrEmpty(indexFile.chunks),
    vectors: arrayOrEmpty(vectorFile.vectors),
    tables: arrayOrEmpty(indexFile.tables).map((table) =>
      normalizeCodeTableRecord(table, nodeById.get(table.nodeId), sourceById)
    ),
    crossReferences: arrayOrEmpty(indexFile.crossReferences),
    diagnostics: arrayOrEmpty(indexFile.diagnostics),
    semanticSearchAvailable: indexFile.semanticSearchAvailable === true,
  };
}

export async function saveBuildingCodeIndex(
  indexDir: string,
  index: BuildingCodeIndex,
  options: SaveBuildingCodeIndexOptions = {}
): Promise<void> {
  assertSupportedVersion(index.version);
  await fs.mkdir(indexDir, { recursive: true });

  const { vectors, ...indexFile } = index;
  const indexPath = path.join(indexDir, 'index.json');
  const vectorPath = path.join(indexDir, 'vectors.json');
  const transactionId = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const stagingDir = path.join(indexDir, `.publish-${transactionId}.staging`);
  const backupDir = path.join(indexDir, `.publish-${transactionId}.backup`);
  const stagedIndexPath = path.join(stagingDir, 'index.json');
  const stagedVectorPath = path.join(stagingDir, 'vectors.json');
  const backupIndexPath = path.join(backupDir, 'index.json');
  const backupVectorPath = path.join(backupDir, 'vectors.json');
  let indexBackedUp = false;
  let vectorsBackedUp = false;
  let indexPromoted = false;
  let vectorsPromoted = false;

  try {
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.mkdir(backupDir, { recursive: true });
    await writeJsonAtomically(stagedIndexPath, indexFile);
    await writeJsonAtomically(stagedVectorPath, {
      version: supportedVersion,
      vectors,
    });
    await loadBuildingCodeIndex(stagingDir);

    indexBackedUp = await moveIfExists(indexPath, backupIndexPath);
    vectorsBackedUp = await moveIfExists(vectorPath, backupVectorPath);

    await fs.rename(stagedIndexPath, indexPath);
    indexPromoted = true;
    await options.afterIndexFilePromoted?.();
    await fs.rename(stagedVectorPath, vectorPath);
    vectorsPromoted = true;
  } catch (error) {
    await rollbackActiveIndexPublish({
      indexPath,
      vectorPath,
      backupIndexPath,
      backupVectorPath,
      indexBackedUp,
      vectorsBackedUp,
      indexPromoted,
      vectorsPromoted,
    });
    throw error;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function moveIfExists(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    await fs.rename(sourcePath, targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function rollbackActiveIndexPublish(options: {
  indexPath: string;
  vectorPath: string;
  backupIndexPath: string;
  backupVectorPath: string;
  indexBackedUp: boolean;
  vectorsBackedUp: boolean;
  indexPromoted: boolean;
  vectorsPromoted: boolean;
}): Promise<void> {
  if (options.indexPromoted) {
    await fs.rm(options.indexPath, { force: true }).catch(() => undefined);
  }
  if (options.vectorsPromoted) {
    await fs.rm(options.vectorPath, { force: true }).catch(() => undefined);
  }
  if (options.indexBackedUp) {
    await fs.rename(options.backupIndexPath, options.indexPath).catch(() => undefined);
  }
  if (options.vectorsBackedUp) {
    await fs.rename(options.backupVectorPath, options.vectorPath).catch(() => undefined);
  }
}

function assertSupportedVersion(version: unknown): asserts version is 1 {
  if (version !== supportedVersion) {
    throw new Error(`Unsupported building-code index version: ${String(version)}`);
  }
}

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeCodeSourceRecord(source: CodeSourceRecord): CodeSourceRecord {
  return {
    ...source,
    documentId: stringOrDefault(source.documentId, source.sourceId),
    localSourcePath: typeof source.localSourcePath === 'string' ? source.localSourcePath : '',
  };
}

function normalizeCodeNodeRecord(
  node: CodeNodeRecord,
  source: CodeSourceRecord | undefined
): CodeNodeRecord {
  return {
    ...node,
    documentId: stringOrDefault(node.documentId, source?.documentId ?? node.sourceId),
    extractionConfidence:
      typeof node.extractionConfidence === 'number' && Number.isFinite(node.extractionConfidence)
        ? node.extractionConfidence
        : 1,
    parser: isStructurallyValidParserProvenance(node.parser)
      ? node.parser
      : fallbackParserProvenance(source, node),
  };
}

function normalizeCodeTableRecord(
  table: CodeTableRecord,
  node: CodeNodeRecord | undefined,
  sourceById: Map<string, CodeSourceRecord>
): CodeTableRecord {
  return {
    ...table,
    rows: table.rows.map((row) => ({
      ...row,
      citation: normalizeCodeTableCitation(row.citation, 'table-row', node, sourceById),
    })),
    notes: table.notes.map((note) => ({
      ...note,
      citation: normalizeCodeTableCitation(note.citation, 'table-note', node, sourceById),
    })),
  };
}

function normalizeCodeTableCitation(
  citation: CodeCitation,
  fallbackNodeType: 'table-row' | 'table-note',
  node: CodeNodeRecord | undefined,
  sourceById: Map<string, CodeSourceRecord>
): CodeCitation {
  const sourceId = stringOrDefault(citation.sourceId, node?.sourceId ?? '');
  const source = sourceById.get(sourceId) ?? (node ? sourceById.get(node.sourceId) : undefined);
  const pageRange = stringOrDefault(citation.pageRange, node?.pageRange ?? '');
  const parserFallbackNode: CodeNodeRecord = {
    nodeId: node?.nodeId ?? '',
    sourceId,
    documentId: node?.documentId ?? source?.documentId ?? sourceId,
    nodeType: citation.nodeType ?? fallbackNodeType,
    logicalRef: citation.logicalRef,
    title: node?.title ?? '',
    text: node?.text ?? '',
    pageRange,
    headingPath: node?.headingPath ?? citation.headingPath ?? [],
    parentNodeId: node?.parentNodeId ?? null,
    childNodeIds: node?.childNodeIds ?? [],
    extractionConfidence: isFiniteNumber(node?.extractionConfidence) ? node.extractionConfidence : 1,
    parser: node?.parser ?? fallbackParserProvenance(source, { pageRange }),
  };

  return {
    ...citation,
    sourceId,
    documentId: stringOrDefault(citation.documentId, source?.documentId ?? node?.documentId ?? sourceId),
    localSourcePath:
      typeof citation.localSourcePath === 'string' ? citation.localSourcePath : source?.localSourcePath ?? '',
    nodeType: citation.nodeType ?? fallbackNodeType,
    pageRange,
    headingPath: Array.isArray(citation.headingPath) ? citation.headingPath : node?.headingPath ?? [],
    extractionConfidence: isFiniteNumber(citation.extractionConfidence)
      ? citation.extractionConfidence
      : parserFallbackNode.extractionConfidence,
    parser: isStructurallyValidParserProvenance(citation.parser)
      ? citation.parser
      : parserFallbackNode.parser,
  };
}

function fallbackParserProvenance(
  source: CodeSourceRecord | undefined,
  node: Pick<CodeNodeRecord, 'pageRange'>
): CodeParserProvenance {
  const isFixture = source?.sourceUrl.startsWith('fixture://') ?? false;

  return {
    name: isFixture ? 'fixture' : 'docling',
    version: isFixture ? 'test-fixture' : 'unknown',
    sourceElementIds: [],
    pageRange: stringOrDefault(node.pageRange, ''),
    boundingBoxes: [],
  };
}

function isStructurallyValidParserProvenance(value: unknown): value is CodeParserProvenance {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.name === 'docling' || value.name === 'liteparse' || value.name === 'fixture') &&
    typeof value.version === 'string' &&
    Array.isArray(value.sourceElementIds) &&
    value.sourceElementIds.every((item) => typeof item === 'string') &&
    typeof value.pageRange === 'string' &&
    isLayoutBoxArray(value.boundingBoxes)
  );
}

function isLayoutBoxArray(value: unknown): value is CodeLayoutBox[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        isFiniteNumber(item.pageNumber) &&
        isFiniteNumber(item.x) &&
        isFiniteNumber(item.y) &&
        isFiniteNumber(item.width) &&
        isFiniteNumber(item.height)
    )
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}
