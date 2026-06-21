import { buildCitation, stableNodeId, stableRecordId } from './hierarchy';
import { detectBuildingCodeHeading } from './heading-detector';
import type { NormalizedParserTable } from './parser-adapter';
import type {
  CodeCitation,
  CodeNodeRecord,
  CodeParserProvenance,
  CodeSourceRecord,
  CodeTableRecord,
} from './types';

export function extractMarkdownTables(
  nodes: CodeNodeRecord[],
  source: CodeSourceRecord
): CodeTableRecord[] {
  return nodes
    .filter((node) => node.nodeType === 'table')
    .map((node) => {
      const { columns, rows, notes } = parseTableText(node.text);
      if (columns.length === 0 && rows.length === 0 && notes.length === 0) {
        return null;
      }
      const citation = buildCitation(source, node);
      const tableId = stableRecordId('table', [source.sourceChecksum, node.nodeId]);

      node.tableId = tableId;

      return {
        tableId,
        nodeId: node.nodeId,
        caption: node.title,
        columns,
        rows: rows.map((cells, index) => ({
          rowId: stableRecordId('table-row', [
            source.sourceChecksum,
            node.nodeId,
            String(index),
            cells.join('|'),
          ]),
          cells,
          citation: citationForTablePart(citation, 'table-row', String(index), cells.join('|')),
        })),
        notes: notes.map((text, index) => ({
          noteId: stableRecordId('table-note', [
            source.sourceChecksum,
            node.nodeId,
            String(index),
            text,
          ]),
          text,
          citation: citationForTablePart(citation, 'table-note', String(index), text),
        })),
      };
    })
    .filter((table): table is CodeTableRecord => table !== null);
}

export function buildStructuredTables(
  nodes: CodeNodeRecord[],
  parserTables: NormalizedParserTable[],
  source: CodeSourceRecord,
  provenance: { name: CodeParserProvenance['name']; version: string } = {
    name: 'fixture',
    version: 'unknown',
  }
): CodeTableRecord[] {
  const fragments = collectStructuredTableFragments(nodes, parserTables, source, provenance);
  const tables = fragments
    .filter((fragment) => hasMeaningfulStructuredTableContent(fragment))
    .map((fragment) => {
      const citation = buildCitation(source, fragment.node);
      const tableId = stableRecordId('table', [
        source.sourceChecksum,
        fragment.node.nodeId,
        fragment.fragments.map((table) => table.elementId).join('|'),
      ]);
      fragment.node.tableId = tableId;

      return {
        tableId,
        nodeId: fragment.node.nodeId,
        caption: fragment.caption,
        columns: fragment.columns,
        rows: fragment.rows.map((cells, index) => ({
          rowId: stableRecordId('table-row', [
            source.sourceChecksum,
            fragment.node.nodeId,
            String(index),
            cells.join('|'),
          ]),
          cells,
          citation: citationForTablePart(citation, 'table-row', String(index), cells.join('|')),
        })),
        notes: fragment.notes.map((text, index) => ({
          noteId: stableRecordId('table-note', [
            source.sourceChecksum,
            fragment.node.nodeId,
            String(index),
            text,
          ]),
          text,
          citation: citationForTablePart(citation, 'table-note', String(index), text),
        })),
      };
    });
  const matchedNodeIds = new Set(fragments.filter(hasMeaningfulStructuredTableContent).map((fragment) => fragment.node.nodeId));
  const unmatchedMarkdownTables = extractMarkdownTables(
    nodes.filter((node) => node.nodeType === 'table' && !matchedNodeIds.has(node.nodeId)),
    source
  );
  return [...tables, ...unmatchedMarkdownTables];
}

export interface StructuredTableFragment {
  node: CodeNodeRecord;
  fragments: NormalizedParserTable[];
  caption: string;
  columns: string[];
  rows: string[][];
  notes: string[];
}

export function collectStructuredTableFragments(
  nodes: CodeNodeRecord[],
  parserTables: NormalizedParserTable[],
  source: CodeSourceRecord,
  provenance: { name: CodeParserProvenance['name']; version: string } = {
    name: 'fixture',
    version: 'unknown',
  }
): StructuredTableFragment[] {
  const fragmentsByNodeId = new Map<string, StructuredTableFragment>();
  const seenFragmentKeys = new Set<string>();

  for (const parserTable of parserTables) {
    const node = findStructuredTableNode(nodes, parserTable) ?? createStructuredTableNode(
      nodes,
      parserTable,
      source,
      provenance
    );
    if (!node) {
      continue;
    }

    const fragmentKey = structuredTableFragmentKey(node.nodeId, parserTable);
    if (seenFragmentKeys.has(fragmentKey)) {
      continue;
    }
    seenFragmentKeys.add(fragmentKey);

    appendSourceElementIds(node, sourceIdsFor(parserTable));
    expandPageRange(node, parserTable.pageNumber);
    node.extractionConfidence = Math.min(node.extractionConfidence, parserTable.confidence);

    const fragment = fragmentsByNodeId.get(node.nodeId) ?? {
      node,
      fragments: [],
      caption: '',
      columns: [],
      rows: [],
      notes: [],
    };

    fragment.fragments.push(parserTable);
    if (!fragment.caption && parserTable.caption.trim()) {
      fragment.caption = parserTable.caption.trim();
    }
    if (fragment.columns.length === 0 && parserTable.columns.length > 0) {
      fragment.columns = [...parserTable.columns];
    }
    mergeTableRows(fragment.rows, parserTable.rows);
    mergeTableNotes(fragment.notes, parserTable.notes);
    fragmentsByNodeId.set(node.nodeId, fragment);
  }

  return [...fragmentsByNodeId.values()].map((fragment) => ({
    ...fragment,
    caption: fragment.caption || fragment.node.title,
  }));
}

function findStructuredTableNode(
  nodes: CodeNodeRecord[],
  parserTable: NormalizedParserTable
): CodeNodeRecord | undefined {
  const sourceElementIds = [...new Set([parserTable.elementId, ...sourceIdsFor(parserTable)])];
  const sourceElementMatch = nodes.find(
    (candidate) =>
      candidate.nodeType === 'table' &&
      sourceElementIds.some((sourceElementId) =>
        candidate.parser.sourceElementIds.includes(sourceElementId)
      )
  );
  if (sourceElementMatch) {
    return sourceElementMatch;
  }

  const heading = detectBuildingCodeHeading(parserTable.caption);
  if (!heading || heading.nodeType !== 'table') {
    return undefined;
  }

  return nodes.find(
    (candidate) => candidate.nodeType === 'table' && candidate.logicalRef === heading.logicalRef
  );
}

function createStructuredTableNode(
  nodes: CodeNodeRecord[],
  parserTable: NormalizedParserTable,
  source: CodeSourceRecord,
  provenance: { name: CodeParserProvenance['name']; version: string }
): CodeNodeRecord | undefined {
  const heading = detectBuildingCodeHeading(parserTable.caption);
  if (!heading || heading.nodeType !== 'table') {
    return undefined;
  }

  const parent = findNearestParentNode(nodes, parserTable.pageNumber);
  const node: CodeNodeRecord = {
    nodeId: stableNodeId(source.sourceChecksum, heading.logicalRef, heading.nodeType),
    sourceId: source.sourceId,
    documentId: source.documentId,
    nodeType: heading.nodeType,
    logicalRef: heading.logicalRef,
    title: heading.title,
    text: '',
    pageRange: String(parserTable.pageNumber),
    headingPath: [...(parent?.headingPath ?? []), parserTable.caption],
    parentNodeId: parent?.nodeId ?? null,
    childNodeIds: [],
    extractionConfidence: parserTable.confidence,
    parser: {
      name: provenance.name,
      version: provenance.version,
      sourceElementIds: sourceIdsFor(parserTable),
      pageRange: String(parserTable.pageNumber),
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

function sourceIdsFor(table: NormalizedParserTable): string[] {
  const sourceIds = Array.isArray(table.sourceIds) && table.sourceIds.length > 0
    ? table.sourceIds
    : [table.elementId];
  return [...new Set(sourceIds)];
}

function appendSourceElementIds(node: CodeNodeRecord, sourceElementIds: string[]): void {
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

function mergeTableRows(rows: string[][], nextRows: string[][]): void {
  const overlapCount = leadingRowOverlap(rows, nextRows);
  for (const row of nextRows.slice(overlapCount)) {
    rows.push([...row]);
  }
}

function mergeTableNotes(notes: string[], nextNotes: string[]): void {
  const normalizedNextNotes = nextNotes.map((note) => note.trim()).filter(Boolean);
  const overlapCount = leadingTextOverlap(notes, normalizedNextNotes);
  for (const note of normalizedNextNotes.slice(overlapCount)) {
    const trimmed = note.trim();
    notes.push(trimmed);
  }
}

function hasMeaningfulStructuredTableContent(fragment: StructuredTableFragment): boolean {
  return fragment.columns.length > 0 || fragment.rows.length > 0 || fragment.notes.length > 0;
}

function structuredTableFragmentKey(nodeId: string, parserTable: NormalizedParserTable): string {
  return [
    nodeId,
    parserTable.caption.trim(),
    parserTable.columns.join('\u0001'),
    parserTable.rows.map((row) => row.join('\u0002')).join('\u0003'),
    parserTable.notes.map((note) => note.trim()).join('\u0004'),
  ].join('\u0000');
}

function leadingRowOverlap(existingRows: string[][], nextRows: string[][]): number {
  const maxOverlap = Math.min(existingRows.length, nextRows.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const existingSlice = existingRows.slice(existingRows.length - overlap);
    const nextSlice = nextRows.slice(0, overlap);
    if (rowsEqual(existingSlice, nextSlice)) {
      return overlap;
    }
  }
  return 0;
}

function leadingTextOverlap(existing: string[], next: string[]): number {
  const maxOverlap = Math.min(existing.length, next.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const existingSlice = existing.slice(existing.length - overlap);
    const nextSlice = next.slice(0, overlap);
    if (existingSlice.every((value, index) => value === nextSlice[index])) {
      return overlap;
    }
  }
  return 0;
}

function rowsEqual(left: string[][], right: string[][]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (row, rowIndex) =>
        row.length === right[rowIndex].length &&
        row.every((cell, cellIndex) => cell === right[rowIndex][cellIndex])
    )
  );
}

function parseTableText(text: string): {
  columns: string[];
  rows: string[][];
  notes: string[];
} {
  const columns: string[] = [];
  const rows: string[][] = [];
  const notes: string[] = [];
  let pendingHeader: string[] | null = null;
  let hasSeparator = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());

      if (pendingHeader && isSeparatorRow(cells) && cells.length === pendingHeader.length) {
        columns.push(...pendingHeader);
        pendingHeader = null;
        hasSeparator = true;
        continue;
      }

      if (hasSeparator) {
        rows.push(cells);
      } else {
        pendingHeader = cells;
      }
      continue;
    }

    if (hasSeparator && /^Note\s+\d+:/i.test(trimmed)) {
      notes.push(trimmed);
    }
  }

  return { columns, rows, notes };
}

function citationForTablePart(
  citation: CodeCitation,
  nodeType: 'table-row' | 'table-note',
  partIdentity: string,
  partText: string
): CodeCitation {
  return {
    ...citation,
    citationId: stableRecordId('citation', [
      citation.sourceChecksum,
      citation.logicalRef,
      nodeType,
      partIdentity,
      partText,
    ]),
    nodeType,
  };
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
