import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCrossReferences } from '../src/main/mcp/building-code/cross-reference';
import { ingestMarkdownFixture } from '../src/main/mcp/building-code/ingest';
import { resolveCrossRefsForNode } from '../src/main/mcp/building-code/retrieval';
import type { CodeNodeRecord } from '../src/main/mcp/building-code/types';

const fixturePath = path.resolve(
  __dirname,
  '../src/main/mcp/building-code/fixtures/nbc-2025-refrigerant-excerpt.md'
);

function fixtureIndex() {
  const markdown = fs.readFileSync(fixturePath, 'utf8');

  return {
    version: 1 as const,
    ...ingestMarkdownFixture(markdown, {
      sourceId: 'ashrae-15-2022-synthetic',
      codeFamily: 'ASHRAE 15',
      edition: '2022',
      jurisdictionScope: 'synthetic-fixture',
      sourceTitle: 'ASHRAE 15 2022 Synthetic Excerpt',
      sourceUrl: 'fixture://nbc-2025-refrigerant-excerpt.md',
    }),
    vectors: [],
  };
}

function node(sourceId: string, nodeId: string, logicalRef: string, text: string): CodeNodeRecord {
  return {
    nodeId,
    sourceId,
    documentId: 'doc-1',
    nodeType: logicalRef.startsWith('Table ') ? 'table' : 'section',
    logicalRef,
    title: logicalRef,
    text,
    pageRange: '1',
    headingPath: [logicalRef],
    parentNodeId: null,
    childNodeIds: [],
    extractionConfidence: 1,
    parser: {
      name: 'docling',
      version: 'test',
      sourceElementIds: [],
      pageRange: '1',
      boundingBoxes: [],
    },
  };
}

describe('building-code cross-reference resolution', () => {
  it('returns cited deterministic cross-reference targets', () => {
    const index = fixtureIndex();

    const result = resolveCrossRefsForNode(index, { ref: 'Section 7.3' });

    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          citation: expect.objectContaining({
            logicalRef: 'Section 8.1',
            displayCitation: 'ASHRAE 15 2022, Section 8.1',
          }),
        }),
        expect.objectContaining({
          citation: expect.objectContaining({
            logicalRef: 'Table 7.3.1',
            displayCitation: 'ASHRAE 15 2022, Table 7.3.1',
          }),
        }),
      ])
    );
    expect(result.diagnostics.unresolvedReferences).toEqual([]);
  });

  it.each([
    ['Section 9.10.3.1', 'Section 9.10.3.1'],
    ['Article 3.2.2.20.', 'Article 3.2.2.20'],
    ['Sentence 9.10.3.1.(1)', 'Sentence 9.10.3.1.(1)'],
    ['Subsection 4.1.5.', 'Subsection 4.1.5'],
    ['Part 6', 'Part 6'],
    ['Chapter 5', 'Chapter 5'],
    ['Table 7.3.1', 'Table 7.3.1'],
    ['Figure 3.1.4', 'Figure 3.1.4'],
    ['Appendix A', 'Appendix A'],
    ['Note A-3.2.1.', 'Note A-3.2.1'],
  ])('resolves expanded reference form %s', (rawText, targetLogicalRef) => {
    const nodes = [
      node('source', 'from', 'Section 1.1.1.1', `See ${rawText}.`),
      node('source', 'target', targetLogicalRef, 'Target text.'),
    ];

    expect(resolveCrossReferences(nodes)).toContainEqual(
      expect.objectContaining({
        rawText,
        targetLogicalRef,
        targetNodeId: 'target',
        status: 'resolved',
      })
    );
  });
});
