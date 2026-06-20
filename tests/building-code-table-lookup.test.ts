import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestMarkdownFixture } from '../src/main/mcp/building-code/ingest';
import { lookupTable } from '../src/main/mcp/building-code/retrieval';

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

describe('building-code table lookup', () => {
  it('returns matching table rows with table and note citations', () => {
    const result = lookupTable(fixtureIndex(), {
      ref: 'Table 7.3.1',
      filters: { Refrigerant: 'R-32' },
    });

    expect(JSON.stringify(result.results)).toContain('R-32');
    expect(JSON.stringify(result.results)).toContain('0.30 kg/m3');
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ evidenceKind: 'table-row' }),
        expect.objectContaining({
          evidenceKind: 'table-note',
          citation: expect.objectContaining({ displayCitation: 'ASHRAE 15 2022, Table 7.3.1' }),
        }),
      ])
    );
  });
});
