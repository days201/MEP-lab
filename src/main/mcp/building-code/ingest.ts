import { buildNodeChunks } from './chunking';
import { adaptDoclingToBuildingCodeIndex } from './canonical-adapter';
import { resolveCrossReferences } from './cross-reference';
import { buildHierarchyFromPageTexts, checksumText } from './hierarchy';
import { pageTextsFromMarkdownFixture, type PageText } from './pdf-extract';
import { extractMarkdownTables } from './table';
import type { NormalizedDoclingResult } from './docling-parser';
import type { KnowledgeBaseDocumentRecord } from '../../../shared/ipc-types';
import type {
  CodeChunkRecord,
  CodeCrossReferenceRecord,
  CodeNodeRecord,
  CodeSourceRecord,
  CodeTableRecord,
} from './types';

export interface BuildingCodeIngestionIndex {
  sources: CodeSourceRecord[];
  pages: PageText[];
  nodes: CodeNodeRecord[];
  chunks: CodeChunkRecord[];
  tables: CodeTableRecord[];
  crossReferences: CodeCrossReferenceRecord[];
  diagnostics: string[];
}

export type MarkdownFixtureSourceInput = Omit<
  CodeSourceRecord,
  'sourceChecksum' | 'documentId' | 'localSourcePath'
> &
  Partial<Pick<CodeSourceRecord, 'documentId' | 'localSourcePath'>>;

export function ingestMarkdownFixture(
  markdown: string,
  sourceInput: MarkdownFixtureSourceInput
): BuildingCodeIngestionIndex {
  const source: CodeSourceRecord = {
    ...sourceInput,
    documentId: sourceInput.documentId ?? sourceInput.sourceId,
    localSourcePath: sourceInput.localSourcePath ?? sourceInput.sourceUrl,
    sourceChecksum: checksumText(markdown),
  };
  const pages = pageTextsFromMarkdownFixture(markdown);
  const nodes = buildHierarchyFromPageTexts(pages, source);
  const tables = extractMarkdownTables(nodes, source);
  const crossReferences = resolveCrossReferences(nodes);
  const chunks = buildNodeChunks(nodes, source);

  return {
    sources: [source],
    pages,
    nodes,
    chunks,
    tables,
    crossReferences,
    diagnostics: [],
  };
}

export function ingestParsedBuildingCodeDocument(
  parsed: NormalizedDoclingResult,
  document: KnowledgeBaseDocumentRecord
): BuildingCodeIngestionIndex {
  return adaptDoclingToBuildingCodeIndex(parsed, document);
}
