import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildCitation,
  buildHierarchyFromPageTexts,
  checksumText,
} from '../src/main/mcp/building-code/hierarchy';
import { ingestMarkdownFixture } from '../src/main/mcp/building-code/ingest';
import type { PageText } from '../src/main/mcp/building-code/pdf-extract';
import type { CodeSourceRecord } from '../src/main/mcp/building-code/types';

const repoRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(
  repoRoot,
  'src/main/mcp/building-code/fixtures/nbc-2025-refrigerant-excerpt.md'
);

function sourceFor(markdown: string): CodeSourceRecord {
  return {
    sourceId: 'ashrae-15-2022-synthetic',
    documentId: 'ashrae-15-2022-synthetic',
    codeFamily: 'ASHRAE 15',
    edition: '2022',
    jurisdictionScope: 'synthetic-fixture',
    sourceTitle: 'ASHRAE 15 2022 Synthetic Excerpt',
    sourceUrl: 'fixture://nbc-2025-refrigerant-excerpt.md',
    localSourcePath: 'fixture://nbc-2025-refrigerant-excerpt.md',
    sourceChecksum: checksumText(markdown),
  };
}

function ingest(markdown: string) {
  const { sourceChecksum: _sourceChecksum, ...sourceInput } = sourceFor(markdown);

  return ingestMarkdownFixture(markdown, sourceInput);
}

describe('building-code fixture ingestion into canonical nodes', () => {
  it('builds a section-aware canonical tree with tables, citations, references, and chunks', () => {
    const markdown = fs.readFileSync(fixturePath, 'utf8');
    const index = ingest(markdown);

    const section72 = index.nodes.find((node) => node.logicalRef === 'Section 7.2');
    const section73 = index.nodes.find((node) => node.logicalRef === 'Section 7.3');
    const section81 = index.nodes.find((node) => node.logicalRef === 'Section 8.1');
    const table731 = index.nodes.find((node) => node.logicalRef === 'Table 7.3.1');

    expect(section72?.text).toContain('Class 2L');
    expect(section73).toBeDefined();
    expect(section81?.parentNodeId).toBeDefined();
    expect(table731?.nodeType).toBe('table');
    expect(table731?.parentNodeId).toBe(section73?.nodeId);
    expect(index.tables[0].rows[0].cells).toContain('R-32');
    expect(index.tables[0].notes[0].citation.displayCitation).toBe('ASHRAE 15 2022, Table 7.3.1');
    expect(index.crossReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromNodeId: section73?.nodeId,
          targetLogicalRef: 'Section 8.1',
          targetNodeId: section81?.nodeId,
          status: 'resolved',
        }),
      ])
    );
    expect(index.chunks.length).toBeGreaterThan(0);
    const nodeIds = new Set(index.nodes.map((node) => node.nodeId));
    expect(index.chunks.every((chunk) => nodeIds.has(chunk.nodeId))).toBe(true);
    expect(index.diagnostics).toEqual([]);
  });

  it('assigns table row and note citations their own stable identities and node types', () => {
    const markdown = fs.readFileSync(fixturePath, 'utf8');
    const index = ingest(markdown);
    const tableNode = index.nodes.find((node) => node.logicalRef === 'Table 7.3.1');

    expect(tableNode).toBeDefined();
    const parentCitation = buildCitation(index.sources[0], tableNode!);
    const rowCitation = index.tables[0].rows[0].citation;
    const noteCitation = index.tables[0].notes[0].citation;

    expect(rowCitation.citationId).not.toBe(parentCitation.citationId);
    expect(noteCitation.citationId).not.toBe(parentCitation.citationId);
    expect(rowCitation.citationId).not.toBe(noteCitation.citationId);
    expect(rowCitation.nodeType).toBe('table-row');
    expect(noteCitation.nodeType).toBe('table-note');
    expect(rowCitation.displayCitation).toBe(parentCitation.displayCitation);
    expect(noteCitation.displayCitation).toBe(parentCitation.displayCitation);
  });

  it('expands node page ranges when a section continues onto later page text', () => {
    const pages: PageText[] = [
      {
        pageNumber: 12,
        text: '# ASHRAE 15 2022 Synthetic Excerpt\n\n## Section 7 Refrigerant Safety\nOpening requirement.',
        sourceOffsetStart: 0,
        sourceOffsetEnd: 89,
      },
      {
        pageNumber: 13,
        text: 'Continuation requirement on the next page.',
        sourceOffsetStart: 90,
        sourceOffsetEnd: 132,
      },
    ];
    const source = sourceFor(pages.map((page) => page.text).join('\n'));
    const nodes = buildHierarchyFromPageTexts(pages, source);
    const section7 = nodes.find((node) => node.logicalRef === 'Section 7');

    expect(section7?.text).toContain('Continuation requirement');
    expect(section7?.pageRange).toBe('12-13');
  });

  it('does not parse pipe-looking table content without a Markdown separator row', () => {
    const markdown = [
      '# ASHRAE 15 2022 Synthetic Excerpt',
      '',
      '## Section 7 Refrigerant Safety',
      '',
      '### Section 7.3 Machinery Room Requirements',
      '',
      '#### Table 7.3.1 Refrigerant Data',
      '| Refrigerant | Class | RCL | EDVC |',
      '| R-32 | 2L | 0.061 kg/m3 | 0.30 kg/m3 |',
    ].join('\n');
    const index = ingest(markdown);

    expect(index.tables[0].columns).toEqual([]);
    expect(index.tables[0].rows).toEqual([]);
  });

  it('bounds chunks for a single long paragraph and maps them to the source node', () => {
    const longParagraph = Array.from({ length: 140 }, (_, index) => `requirement-${index}`)
      .join(' ');
    const markdown = [
      '# ASHRAE 15 2022 Synthetic Excerpt',
      '',
      '## Section 7 Refrigerant Safety',
      '',
      longParagraph,
    ].join('\n');
    const index = ingest(markdown);
    const section7 = index.nodes.find((node) => node.logicalRef === 'Section 7');
    const sectionChunks = index.chunks.filter((chunk) => chunk.nodeId === section7?.nodeId);

    expect(section7).toBeDefined();
    expect(longParagraph.length).toBeGreaterThan(800);
    expect(sectionChunks.length).toBeGreaterThan(1);
    expect(sectionChunks.every((chunk) => chunk.text.length <= 800)).toBe(true);
    expect(sectionChunks.every((chunk) => chunk.nodeId === section7?.nodeId)).toBe(true);
  });
});
