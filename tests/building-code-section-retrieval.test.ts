import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { embedMissingChunks } from '../src/main/mcp/building-code/embedding';
import { ingestMarkdownFixture } from '../src/main/mcp/building-code/ingest';
import type { BuildingCodeIndex } from '../src/main/mcp/building-code/index-store';
import { readSection, searchBuildingCode } from '../src/main/mcp/building-code/retrieval';

const fixturePath = path.resolve(
  __dirname,
  '../src/main/mcp/building-code/fixtures/nbc-2025-refrigerant-excerpt.md'
);

class FakeEmbeddingClient {
  model = 'text-embedding-3-small';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => [
      text.toLowerCase().includes('r-32') ? 3 : 0,
      text.toLowerCase().includes('edvc') ? 3 : 0,
      text.toLowerCase().includes('flammable') ? 2 : 0,
      text.toLowerCase().includes('section 7.2') ? 1 : 0,
    ]);
  }
}

async function fixtureIndex(): Promise<BuildingCodeIndex> {
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  const index: BuildingCodeIndex = {
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
    semanticSearchAvailable: false,
  };
  index.vectors = await embedMissingChunks(index, new FakeEmbeddingClient());
  index.semanticSearchAvailable = true;

  return index;
}

describe('building-code section-centered retrieval', () => {
  it('maps semantic candidates back to cited canonical nodes', async () => {
    const index = await fixtureIndex();
    const section72 = index.nodes.find((node) => node.logicalRef === 'Section 7.2');

    const results = await searchBuildingCode(index, {
      query: 'R-32 EDVC value and flammable refrigerant assumptions',
      embeddingClient: new FakeEmbeddingClient(),
      limit: 4,
    });

    expect(results.results[0].citation.logicalRef).toBe('Table 7.3.1');
    expect(results.results.map((result) => result.nodeId)).toContain(section72?.nodeId);
    expect(results.results.every((result) => result.fullText || result.excerpt)).toBe(true);
    expect(results.results.every((result) => result.citation.displayCitation)).toBe(true);
  });

  it('reads full section text by logical reference', async () => {
    const index = await fixtureIndex();

    const result = readSection(index, { ref: 'Section 7.3' });

    expect(result.results[0].fullText).toContain('Where a refrigerant listed in Table 7.3.1');
    expect(result.results[0].citation.displayCitation).toBe('ASHRAE 15 2022, Section 7.3');
  });
});
