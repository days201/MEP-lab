import { buildCitation, stableRecordId } from './hierarchy';
import type { NormalizedDoclingTable } from './docling-parser';
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
  doclingTables: NormalizedDoclingTable[],
  source: CodeSourceRecord
): CodeTableRecord[] {
  const tables: CodeTableRecord[] = [];
  for (const doclingTable of doclingTables) {
    const node = nodes.find((candidate) =>
      candidate.parser.sourceElementIds.includes(doclingTable.elementId)
    );
    if (!node) {
      continue;
    }
    const citation = buildCitation(source, node);
    const tableId = stableRecordId('table', [
      source.sourceChecksum,
      node.nodeId,
      doclingTable.elementId,
    ]);
    node.tableId = tableId;
    tables.push({
      tableId,
      nodeId: node.nodeId,
      caption: doclingTable.caption,
      columns: doclingTable.columns,
      rows: doclingTable.rows.map((cells, index) => ({
        rowId: stableRecordId('table-row', [
          source.sourceChecksum,
          node.nodeId,
          String(index),
          cells.join('|'),
        ]),
        cells,
        citation: citationForTablePart(citation, 'table-row', String(index), cells.join('|')),
      })),
      notes: doclingTable.notes.map((text, index) => ({
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
  return tables.length > 0 ? tables : extractMarkdownTables(nodes, source);
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
