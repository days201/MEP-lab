import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ingestMarkdownFixture } from '../src/main/mcp/building-code/ingest';

const repoRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(
  repoRoot,
  'src/main/mcp/building-code/fixtures/nbc-2025-refrigerant-excerpt.md'
);

describe('building-code fixture ingestion into canonical nodes', () => {
  it('builds a section-aware canonical tree with tables, citations, references, and chunks', () => {
    const markdown = fs.readFileSync(fixturePath, 'utf8');
    const index = ingestMarkdownFixture(markdown, {
      sourceId: 'ashrae-15-2022-synthetic',
      codeFamily: 'ASHRAE 15',
      edition: '2022',
      jurisdictionScope: 'synthetic-fixture',
      sourceTitle: 'ASHRAE 15 2022 Synthetic Excerpt',
      sourceUrl: 'fixture://nbc-2025-refrigerant-excerpt.md',
    });

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
    expect(index.tables[0].notes[0].citation.displayCitation).toBe(
      'ASHRAE 15 2022, Table 7.3.1'
    );
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
    expect(index.chunks.every((chunk) => chunk.nodeId)).toBe(true);
    expect(index.diagnostics).toEqual([]);
  });
});
