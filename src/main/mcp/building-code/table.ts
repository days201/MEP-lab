import { buildCitation, stableRecordId } from './hierarchy';
import type {
  CodeCitation,
  CodeNodeRecord,
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
          citation: citationForTablePart(citation, node.logicalRef),
        })),
        notes: notes.map((text, index) => ({
          noteId: stableRecordId('table-note', [
            source.sourceChecksum,
            node.nodeId,
            String(index),
            text,
          ]),
          text,
          citation: citationForTablePart(citation, node.logicalRef),
        })),
      };
    });
}

function parseTableText(text: string): {
  columns: string[];
  rows: string[][];
  notes: string[];
} {
  const columns: string[] = [];
  const rows: string[][] = [];
  const notes: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());

      if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        continue;
      }

      if (columns.length === 0) {
        columns.push(...cells);
      } else {
        rows.push(cells);
      }
      continue;
    }

    if (/^Note\s+\d+:/i.test(trimmed)) {
      notes.push(trimmed);
    }
  }

  return { columns, rows, notes };
}

function citationForTablePart(citation: CodeCitation, logicalRef: string): CodeCitation {
  return {
    ...citation,
    logicalRef,
    nodeType: 'table',
  };
}
