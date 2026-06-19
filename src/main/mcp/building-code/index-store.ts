import fs from 'node:fs/promises';
import path from 'node:path';
import type { PageText } from './pdf-extract';
import type {
  CodeChunkRecord,
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
}

type BuildingCodeIndexFile = Omit<BuildingCodeIndex, 'vectors'>;

const supportedVersion = 1;

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

  return {
    version: supportedVersion,
    sources,
    pages: arrayOrEmpty(indexFile.pages),
    nodes: arrayOrEmpty(indexFile.nodes).map((node) =>
      normalizeCodeNodeRecord(node, sourceById.get(node.sourceId))
    ),
    chunks: arrayOrEmpty(indexFile.chunks),
    vectors: arrayOrEmpty(vectorFile.vectors),
    tables: arrayOrEmpty(indexFile.tables),
    crossReferences: arrayOrEmpty(indexFile.crossReferences),
    diagnostics: arrayOrEmpty(indexFile.diagnostics),
  };
}

export async function saveBuildingCodeIndex(
  indexDir: string,
  index: BuildingCodeIndex
): Promise<void> {
  assertSupportedVersion(index.version);
  await fs.mkdir(indexDir, { recursive: true });

  const { vectors, ...indexFile } = index;

  await writeJsonAtomically(path.join(indexDir, 'index.json'), indexFile);
  await writeJsonAtomically(path.join(indexDir, 'vectors.json'), {
    version: supportedVersion,
    vectors,
  });
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

function fallbackParserProvenance(
  source: CodeSourceRecord | undefined,
  node: CodeNodeRecord
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
    (value.name === 'docling' || value.name === 'fixture') &&
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
        typeof item.pageNumber === 'number' &&
        typeof item.x === 'number' &&
        typeof item.y === 'number' &&
        typeof item.width === 'number' &&
        typeof item.height === 'number'
    )
  );
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}
