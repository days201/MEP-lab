import { buildNodeChunks } from './chunking';
import { resolveCrossReferences } from './cross-reference';
import { detectBuildingCodeHeading } from './heading-detector';
import { stableNodeId, stableRecordId } from './hierarchy';
import { buildStructuredTables } from './table';
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

  if (!hasStructuralBuildingCodeHeading(nodes)) {
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
    diagnostics: [
      ...parsed.diagnostics,
      ...parsed.pageDiagnostics
        .filter((diagnostic) => diagnostic.severity !== 'info')
        .map((diagnostic) => `Page ${diagnostic.pageNumber}: ${diagnostic.message}`),
    ],
  };
}

export const adaptDoclingToBuildingCodeIndex = adaptParserDocumentToBuildingCodeIndex;

function hasStructuralBuildingCodeHeading(nodes: CodeNodeRecord[]): boolean {
  return nodes.some((node) =>
    node.nodeType === 'section' || node.nodeType === 'subsection' || node.nodeType === 'appendix'
  );
}

function buildNodes(
  parsed: NormalizedParserDocument,
  source: CodeSourceRecord,
  document: KnowledgeBaseDocumentRecord
): CodeNodeRecord[] {
  const nodes: CodeNodeRecord[] = [];
  const stack: StackEntry[] = [];
  const parserVersion = parsed.parserVersion;
  const parserName = parsed.parserName;

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
          name: parserName,
          version: parserVersion,
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
    if (element.bbox) {
      current.parser.boundingBoxes.push({ pageNumber: element.pageNumber, ...element.bbox });
    }
    if (Number.isFinite(element.confidence)) {
      current.extractionConfidence = Math.min(current.extractionConfidence, element.confidence);
    }
    expandPageRange(current, element.pageNumber);
  }

  attachTableText(nodes, parsed.tables, parsed.elements, source, document, parserName, parserVersion);
  return nodes.map((node) => ({ ...node, text: node.text.trim() }));
}

function attachTableText(
  nodes: CodeNodeRecord[],
  tables: NormalizedParserTable[],
  elements: NormalizedParserElement[],
  source: CodeSourceRecord,
  document: KnowledgeBaseDocumentRecord,
  parserName: NormalizedParserDocument['parserName'],
  parserVersion: string
): void {
  const elementsById = new Map(elements.map((element) => [element.elementId, element]));

  for (const table of tables) {
    const heading = detectBuildingCodeHeading(table.caption);
    if (!heading || heading.nodeType !== 'table') {
      continue;
    }
    const node =
      nodes.find(
        (candidate) => candidate.nodeType === 'table' && candidate.logicalRef === heading.logicalRef
      ) ??
      createTableNodeFromCaption(nodes, table, heading, source, document, parserName, parserVersion);

    if (!node.parser.sourceElementIds.includes(table.elementId)) {
      node.parser.sourceElementIds.push(table.elementId);
    }
    appendTableElementBoundingBox(node, elementsById.get(table.elementId));
    node.extractionConfidence = Math.min(node.extractionConfidence, table.confidence);
    expandPageRange(node, table.pageNumber);

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

function createTableNodeFromCaption(
  nodes: CodeNodeRecord[],
  table: NormalizedParserTable,
  heading: NonNullable<ReturnType<typeof detectBuildingCodeHeading>>,
  source: CodeSourceRecord,
  document: KnowledgeBaseDocumentRecord,
  parserName: NormalizedParserDocument['parserName'],
  parserVersion: string
): CodeNodeRecord {
  const parent = findNearestParentNode(nodes, table.pageNumber);
  const node: CodeNodeRecord = {
    nodeId: stableNodeId(source.sourceChecksum, heading.logicalRef, heading.nodeType),
    sourceId: source.sourceId,
    documentId: document.documentId,
    nodeType: heading.nodeType,
    logicalRef: heading.logicalRef,
    title: heading.title,
    text: '',
    pageRange: String(table.pageNumber),
    headingPath: [...(parent?.headingPath ?? []), table.caption],
    parentNodeId: parent?.nodeId ?? null,
    childNodeIds: [],
    extractionConfidence: table.confidence,
    parser: {
      name: parserName,
      version: parserVersion,
      sourceElementIds: [table.elementId],
      pageRange: String(table.pageNumber),
      boundingBoxes: [],
    },
  };

  if (parent) {
    parent.childNodeIds.push(node.nodeId);
  }
  nodes.push(node);
  return node;
}

function findNearestParentNode(nodes: CodeNodeRecord[], pageNumber: number): CodeNodeRecord | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const candidate = nodes[index];
    if (candidate.nodeType === 'table') {
      continue;
    }
    const [startText] = candidate.pageRange.split('-');
    const start = Number(startText);
    if (!Number.isFinite(start) || start <= pageNumber) {
      return candidate;
    }
  }
  return null;
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
