import { buildNodeChunks } from './chunking';
import { resolveCrossReferences } from './cross-reference';
import { detectBuildingCodeHeading } from './heading-detector';
import { stableNodeId, stableRecordId } from './hierarchy';
import { buildStructuredTables, collectStructuredTableFragments } from './table';
import type {
  NormalizedParserDocument,
  NormalizedParserElement,
  NormalizedParserTable,
} from './parser-adapter';
import type { BuildingCodeIngestionIndex } from './ingest';
import type { PageText } from './pdf-extract';
import type { CodeNodeRecord, CodeSourceRecord } from './types';
import type { KnowledgeBaseDocumentRecord } from '../../../shared/ipc-types';

interface StackEntry {
  level: number;
  node: CodeNodeRecord;
}

export function adaptParserDocumentToBuildingCodeIndex(
  parsed: NormalizedParserDocument,
  document: KnowledgeBaseDocumentRecord
): BuildingCodeIngestionIndex {
  const parserVersion = parsed.parserVersion;
  const parserName = parsed.parserName;
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
  const nodes = buildNodes(parsed, source, document.documentId, parserName, parserVersion);

  if (!hasStructuralBuildingCodeHeading(nodes)) {
    throw new Error('no canonical building-code sections found');
  }

  const tables = buildStructuredTables(nodes, parsed.tables, source, {
    name: parserName,
    version: parserVersion,
  });
  const crossReferences = resolveCrossReferences(nodes);
  const chunks = buildNodeChunks(nodes, source);

  return {
    sources: [source],
    pages,
    nodes,
    chunks,
    tables,
    crossReferences,
    diagnostics: [
      ...parsed.diagnostics,
      ...(parsed.pageDiagnostics ?? [])
        .filter((diagnostic) => diagnostic.severity !== 'info')
        .map((diagnostic) => `Page ${diagnostic.pageNumber}: ${diagnostic.message}`),
    ],
  };
}

function hasStructuralBuildingCodeHeading(nodes: CodeNodeRecord[]): boolean {
  return nodes.some((node) =>
    node.nodeType === 'section' || node.nodeType === 'subsection' || node.nodeType === 'appendix'
  );
}

function buildNodes(
  parsed: NormalizedParserDocument,
  source: CodeSourceRecord,
  documentId: string,
  parserName: NormalizedParserDocument['parserName'],
  parserVersion: string
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
      const existing =
        heading.nodeType === 'table'
          ? nodes.find(
              (candidate) =>
                candidate.nodeType === 'table' && candidate.logicalRef === heading.logicalRef
            ) ?? null
          : null;

      if (existing) {
        appendSourceElementIds(existing, sourceIdsFor(element));
        if (element.bbox) {
          existing.parser.boundingBoxes.push({ pageNumber: element.pageNumber, ...element.bbox });
        }
        existing.extractionConfidence = Math.min(existing.extractionConfidence, element.confidence);
        expandPageRange(existing, element.pageNumber);
        stack.push({ level: heading.level, node: existing });
        continue;
      }

      const node: CodeNodeRecord = {
        nodeId: stableNodeId(source.sourceChecksum, heading.logicalRef, heading.nodeType),
        sourceId: source.sourceId,
        documentId,
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
          name: parserName,
          version: parserVersion,
          sourceElementIds: sourceIdsFor(element),
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
    appendSourceElementIds(current, sourceIdsFor(element));
    if (element.bbox) {
      current.parser.boundingBoxes.push({ pageNumber: element.pageNumber, ...element.bbox });
    }
    if (Number.isFinite(element.confidence)) {
      current.extractionConfidence = Math.min(current.extractionConfidence, element.confidence);
    }
    expandPageRange(current, element.pageNumber);
  }

  attachTableText(nodes, parsed.tables, parsed.elements, source, parserName, parserVersion);
  return nodes.map((node) => ({ ...node, text: node.text.trim() }));
}

function attachTableText(
  nodes: CodeNodeRecord[],
  tables: NormalizedParserTable[],
  elements: NormalizedParserElement[],
  source: CodeSourceRecord,
  parserName: NormalizedParserDocument['parserName'],
  parserVersion: string
): void {
  const elementsById = new Map(elements.map((element) => [element.elementId, element]));
  const fragments = collectStructuredTableFragments(nodes, tables, source, {
    name: parserName,
    version: parserVersion,
  });

  for (const fragment of fragments) {
    if (!hasMeaningfulStructuredTableContent(fragment)) {
      continue;
    }

    const node = fragment.node;
    if (!node.tableId) {
      node.tableId = stableRecordId('table', [
        source.sourceChecksum,
        node.nodeId,
        fragment.fragments.map((table) => table.elementId).join('|'),
      ]);
    }

    for (const table of fragment.fragments) {
      appendTableElementBoundingBox(node, elementsById.get(table.elementId));
    }

    const markdown = structuredTableMarkdown(fragment.caption, fragment.columns, fragment.rows, fragment.notes);
    node.text = node.text ? `${node.text}\n${markdown}` : markdown;
  }
}

function appendTableElementBoundingBox(
  node: CodeNodeRecord,
  element: NormalizedParserElement | undefined
): void {
  if (!element?.bbox) {
    return;
  }

  const box = { pageNumber: element.pageNumber, ...element.bbox };
  if (
    node.parser.boundingBoxes.some(
      (candidate) =>
        candidate.pageNumber === box.pageNumber &&
        candidate.x === box.x &&
        candidate.y === box.y &&
        candidate.width === box.width &&
        candidate.height === box.height
    )
  ) {
    return;
  }

  node.parser.boundingBoxes.push(box);
}

function hasMeaningfulStructuredTableContent(
  fragment: ReturnType<typeof collectStructuredTableFragments>[number]
): boolean {
  return fragment.columns.length > 0 || fragment.rows.length > 0 || fragment.notes.length > 0;
}

function structuredTableMarkdown(
  caption: string,
  columns: string[],
  rows: string[][],
  notes: string[]
): string {
  return [caption, `| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`), ...notes].join('\n');
}

function sourceIdsFor(value: {
  elementId: string;
  sourceIds?: string[];
}): string[] {
  const sourceIds = Array.isArray(value.sourceIds) && value.sourceIds.length > 0
    ? value.sourceIds
    : [value.elementId];

  return [...new Set(sourceIds)];
}

function appendSourceElementIds(
  node: CodeNodeRecord,
  sourceElementIds: string[]
): void {
  for (const sourceElementId of sourceElementIds) {
    if (!node.parser.sourceElementIds.includes(sourceElementId)) {
      node.parser.sourceElementIds.push(sourceElementId);
    }
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
