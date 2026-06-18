import { buildNodeChunks } from './chunking';
import { resolveCrossReferences } from './cross-reference';
import { buildHierarchyFromPageTexts, checksumText } from './hierarchy';
import { pageTextsFromMarkdownFixture, type PageText } from './pdf-extract';
import { extractMarkdownTables } from './table';
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

export type MarkdownFixtureSourceInput = Omit<CodeSourceRecord, 'sourceChecksum'>;

export function ingestMarkdownFixture(
  markdown: string,
  sourceInput: MarkdownFixtureSourceInput
): BuildingCodeIngestionIndex {
  const source: CodeSourceRecord = {
    ...sourceInput,
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
