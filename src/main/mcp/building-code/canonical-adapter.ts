import { buildNodeChunks } from './chunking';
import { resolveCrossReferences } from './cross-reference';
import { detectBuildingCodeHeading } from './heading-detector';
import { stableNodeId, stableRecordId } from './hierarchy';
import { buildStructuredTables } from './table';
import type { NormalizedDoclingResult, NormalizedDoclingTable } from './docling-parser';
import type { BuildingCodeIngestionIndex } from './ingest';
import type { PageText } from './pdf-extract';
import type { CodeNodeRecord, CodeSourceRecord } from './types';
import type { KnowledgeBaseDocumentRecord } from '../../../shared/ipc-types';

interface StackEntry {
  level: number;
  node: CodeNodeRecord;
}

export function adaptDoclingToBuildingCodeIndex(
  parsed: NormalizedDoclingResult,
  document: KnowledgeBaseDocumentRecord
): BuildingCodeIngestionIndex {
  const source: CodeSourceRecord = {
    sourceId: stableRecordId('source', [document.documentId, document.sourceChecksum]),
    documentId: document.documentId,
    codeFamily: document.metadata.codeFamily,
    edition: document.metadata.edition,
    jurisdictionScope: document.metadata.jurisdictionScope,
    sourceTitle: document.metadata.sourceTitle,
    sourceUrl: document.sourceUri,
    localSourcePath: document.sourcePath,
    sourceChecksum: document.sourceChecksum,
  };
  const pages: PageText[] = parsed.pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: page.text,
    sourceOffsetStart: 0,
    sourceOffsetEnd: page.text.length,
  }));
  const nodes = buildNodes(parsed, source, document);

  if (nodes.length === 0) {
    throw new Error('no canonical building-code sections found');
  }

  const tables = buildStructuredTables(nodes, parsed.tables, source);
  const crossReferences = resolveCrossReferences(nodes);
  const chunks = buildNodeChunks(nodes, source);

  return {
    sources: [source],
    pages,
    nodes,
    chunks,
    tables,
    crossReferences,
    diagnostics: parsed.diagnostics,
  };
}

function buildNodes(
  parsed: NormalizedDoclingResult,
  source: CodeSourceRecord,
  document: KnowledgeBaseDocumentRecord
): CodeNodeRecord[] {
  const nodes: CodeNodeRecord[] = [];
  const stack: StackEntry[] = [];

  for (const element of parsed.elements) {
    const heading = detectBuildingCodeHeading(element.text);
    if (heading) {
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }
      const parent = stack.at(-1)?.node ?? null;
      const node: CodeNodeRecord = {
        nodeId: stableNodeId(source.sourceChecksum, heading.logicalRef, heading.nodeType),
        sourceId: source.sourceId,
        documentId: document.documentId,
        nodeType: heading.nodeType,
        logicalRef: heading.logicalRef,
        title: heading.title,
        text: '',
        pageRange: String(element.pageNumber),
        headingPath: [...stack.map((entry) => displayHeading(entry.node)), element.text],
        parentNodeId: parent?.nodeId ?? null,
        childNodeIds: [],
        extractionConfidence: element.confidence,
        parser: {
          name: 'docling',
          version: document.parserVersion,
          sourceElementIds: [element.elementId],
          pageRange: String(element.pageNumber),
          boundingBoxes: element.bbox ? [{ pageNumber: element.pageNumber, ...element.bbox }] : [],
        },
      };
      if (parent) {
        parent.childNodeIds.push(node.nodeId);
      }
      nodes.push(node);
      stack.push({ level: heading.level, node });
      continue;
    }

    const current = stack.at(-1)?.node;
    if (!current || !element.text.trim()) {
      continue;
    }
    current.text = current.text ? `${current.text}\n${element.text}` : element.text;
    current.parser.sourceElementIds.push(element.elementId);
    expandPageRange(current, element.pageNumber);
  }

  attachTableText(nodes, parsed.tables);
  return nodes.map((node) => ({ ...node, text: node.text.trim() }));
}

function attachTableText(nodes: CodeNodeRecord[], tables: NormalizedDoclingTable[]): void {
  for (const table of tables) {
    const heading = detectBuildingCodeHeading(table.caption);
    if (!heading) {
      continue;
    }
    const node = nodes.find((candidate) => candidate.logicalRef === heading.logicalRef);
    if (!node) {
      continue;
    }
    const markdown = [
      table.caption,
      `| ${table.columns.join(' | ')} |`,
      `| ${table.columns.map(() => '---').join(' | ')} |`,
      ...table.rows.map((row) => `| ${row.join(' | ')} |`),
      ...table.notes,
    ].join('\n');
    node.text = node.text ? `${node.text}\n${markdown}` : markdown;
  }
}

function expandPageRange(node: CodeNodeRecord, pageNumber: number): void {
  const [startText, endText] = node.pageRange.split('-');
  const start = Number(startText);
  const end = Number(endText ?? startText);
  if (Number.isFinite(start) && Number.isFinite(end) && pageNumber > end) {
    node.pageRange = `${start}-${pageNumber}`;
    node.parser.pageRange = node.pageRange;
  }
}

function displayHeading(node: CodeNodeRecord): string {
  return node.title === node.logicalRef ? node.logicalRef : `${node.logicalRef} ${node.title}`;
}
