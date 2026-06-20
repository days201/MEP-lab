import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestMarkdownFixture } from '../src/main/mcp/building-code/ingest';
import { resolveCrossRefsForNode } from '../src/main/mcp/building-code/retrieval';

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
});
