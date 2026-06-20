import { buildCitation, stableRecordId } from './hierarchy';
import { detectBuildingCodeHeading } from './heading-detector';
import type { NormalizedParserTable } from './parser-adapter';
import type { CodeCitation, CodeNodeRecord, CodeSourceRecord, CodeTableRecord } from './types';

export function extractMarkdownTables(
  nodes: CodeNodeRecord[],
  source: CodeSourceRecord
): CodeTableRecord[] {
  return nodes
    .filter((node) => node.nodeType === 'table')
    .map((node) => {
      const { columns, rows, notes } = parseTableText(node.text);
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
    });
}

export function buildStructuredTables(
  nodes: CodeNodeRecord[],
  parserTables: NormalizedParserTable[],
  source: CodeSourceRecord
): CodeTableRecord[] {
  const tables: CodeTableRecord[] = [];
  const matchedNodeIds = new Set<string>();
  for (const parserTable of parserTables) {
    const node = findStructuredTableNode(nodes, parserTable);
    if (!node) {
      continue;
    }
    const citation = buildCitation(source, node);
    const tableId = stableRecordId('table', [
      source.sourceChecksum,
      node.nodeId,
      parserTable.elementId,
    ]);
    node.tableId = tableId;
    for (const sourceElementId of sourceIdsFor(parserTable)) {
      if (!node.parser.sourceElementIds.includes(sourceElementId)) {
        node.parser.sourceElementIds.push(sourceElementId);
      }
    }
    matchedNodeIds.add(node.nodeId);
    tables.push({
      tableId,
      nodeId: node.nodeId,
      caption: parserTable.caption,
      columns: parserTable.columns,
      rows: parserTable.rows.map((cells, index) => ({
        rowId: stableRecordId('table-row', [
          source.sourceChecksum,
          node.nodeId,
          String(index),
          cells.join('|'),
        ]),
        cells,
        citation: citationForTablePart(citation, 'table-row', String(index), cells.join('|')),
      })),
      notes: parserTable.notes.map((text, index) => ({
        noteId: stableRecordId('table-note', [
          source.sourceChecksum,
          node.nodeId,
          String(index),
          text,
        ]),
        text,
        citation: citationForTablePart(citation, 'table-note', String(index), text),
      })),
    });
  }
  const unmatchedMarkdownTables = extractMarkdownTables(
    nodes.filter((node) => node.nodeType === 'table' && !matchedNodeIds.has(node.nodeId)),
    source
  );
  return [...tables, ...unmatchedMarkdownTables];
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

function sourceIdsFor(table: NormalizedParserTable): string[] {
  const sourceIds = Array.isArray(table.sourceIds) && table.sourceIds.length > 0
    ? table.sourceIds
    : [table.elementId];
  return [...new Set(sourceIds)];
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
