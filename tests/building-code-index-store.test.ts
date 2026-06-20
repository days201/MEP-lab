import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertCitedEvidence } from '../src/main/mcp/building-code/citation';
import { loadBuildingCodeIndex, saveBuildingCodeIndex } from '../src/main/mcp/building-code/index-store';
import type { BuildingCodeIndex } from '../src/main/mcp/building-code/index-store';

const tempRoots: string[] = [];

function minimalIndex(): BuildingCodeIndex {
  return {
    version: 1,
    sources: [],
    pages: [],
    nodes: [],
    chunks: [],
    vectors: [
      {
        chunkId: 'chunk-1',
        embeddingModel: 'text-embedding-3-small',
        embedding: [1, 0],
        embeddingTextHash: 'sha256:abc',
      },
    ],
    tables: [],
    crossReferences: [],
    diagnostics: ['fixture diagnostic'],
    semanticSearchAvailable: true,
  };
}

describe('building-code index store', () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('persists canonical index data and vectors into versioned JSON files', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);
    const index = minimalIndex();

    await saveBuildingCodeIndex(tempRoot, index);
    const loaded = await loadBuildingCodeIndex(tempRoot);

    expect(fs.existsSync(path.join(tempRoot, 'index.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, 'vectors.json'))).toBe(true);
    expect(loaded).toEqual(index);
  });

  it('preserves LiteParse parser provenance across save and load', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);

    const parser = {
      name: 'liteparse' as const,
      version: '0.7.1',
      sourceElementIds: ['lp-table-1'],
      pageRange: '12',
      boundingBoxes: [
        {
          pageNumber: 12,
          x: 72,
          y: 144,
          width: 360,
          height: 120,
        },
      ],
    };
    const source = {
      sourceId: 'source-liteparse-1',
      documentId: 'doc-liteparse-1',
      codeFamily: 'NBC',
      edition: '2025',
      jurisdictionScope: 'Canada',
      sourceTitle: 'LiteParse NBC fixture',
      sourceUrl: 'https://example.test/nbc-liteparse.pdf',
      localSourcePath: 'fixtures/nbc-liteparse.pdf',
      sourceChecksum: 'sha256:liteparse',
    };
    const index: BuildingCodeIndex = {
      ...minimalIndex(),
      sources: [source],
      nodes: [
        {
          nodeId: 'node-liteparse-table-1',
          sourceId: source.sourceId,
          documentId: source.documentId,
          nodeType: 'table',
          logicalRef: 'Table 6.2.1.1',
          title: 'LiteParse table',
          text: 'LiteParse table text.',
          pageRange: '12',
          headingPath: ['NBC 2025', 'Table 6.2.1.1 LiteParse table'],
          parentNodeId: null,
          childNodeIds: [],
          extractionConfidence: 0.93,
          parser,
        },
      ],
      tables: [
        {
          tableId: 'table-liteparse-1',
          nodeId: 'node-liteparse-table-1',
          caption: 'LiteParse table',
          columns: ['Item', 'Value'],
          rows: [
            {
              rowId: 'row-liteparse-1',
              cells: ['A', 'B'],
              citation: {
                status: 'complete',
                citationId: 'citation-liteparse-row-1',
                sourceId: source.sourceId,
                documentId: source.documentId,
                codeFamily: source.codeFamily,
                edition: source.edition,
                jurisdictionScope: source.jurisdictionScope,
                sourceTitle: source.sourceTitle,
                sourceUrl: source.sourceUrl,
                localSourcePath: source.localSourcePath,
                sourceChecksum: source.sourceChecksum,
                logicalRef: 'Table 6.2.1.1, Row 1',
                nodeType: 'table-row',
                pageRange: '12',
                headingPath: ['NBC 2025', 'Table 6.2.1.1 LiteParse table'],
                extractionConfidence: 0.93,
                parser,
                displayCitation: 'NBC 2025, Table 6.2.1.1, Row 1',
              },
            },
          ],
          notes: [
            {
              noteId: 'note-liteparse-a',
              text: 'LiteParse note.',
              citation: {
                status: 'partial',
                citationId: 'citation-liteparse-note-a',
                sourceId: source.sourceId,
                documentId: source.documentId,
                codeFamily: source.codeFamily,
                edition: source.edition,
                jurisdictionScope: source.jurisdictionScope,
                sourceTitle: source.sourceTitle,
                sourceUrl: source.sourceUrl,
                localSourcePath: source.localSourcePath,
                sourceChecksum: source.sourceChecksum,
                logicalRef: 'Table 6.2.1.1, Note a',
                nodeType: 'table-note',
                pageRange: '12',
                headingPath: ['NBC 2025', 'Table 6.2.1.1 LiteParse table'],
                extractionConfidence: 0.93,
                parser,
                displayCitation: 'NBC 2025, Table 6.2.1.1, Note a',
              },
            },
          ],
        },
      ],
    };

    await saveBuildingCodeIndex(tempRoot, index);
    const loaded = await loadBuildingCodeIndex(tempRoot);

    expect(loaded.nodes[0].parser).toEqual(parser);
    expect(loaded.tables[0].rows[0].citation.parser).toEqual(parser);
    expect(loaded.tables[0].notes[0].citation.parser).toEqual(parser);
  });

  it('rejects unsupported index schema versions', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);

    fs.writeFileSync(
      path.join(tempRoot, 'index.json'),
      JSON.stringify({
        ...minimalIndex(),
        version: 999,
        vectors: undefined,
      })
    );
    fs.writeFileSync(path.join(tempRoot, 'vectors.json'), JSON.stringify({ version: 1, vectors: [] }));

    await expect(loadBuildingCodeIndex(tempRoot)).rejects.toThrow('Unsupported building-code index');
  });

  it('normalizes provenance defaults when loading legacy-shaped v1 index records', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);

    fs.writeFileSync(
      path.join(tempRoot, 'index.json'),
      JSON.stringify({
        ...minimalIndex(),
        sources: [
          {
            sourceId: 'legacy-source-1',
            codeFamily: 'NBC',
            edition: '2025',
            jurisdictionScope: 'Canada',
            sourceTitle: 'Legacy NBC fixture',
            sourceUrl: 'fixture://nbc-2025-refrigerant-excerpt.md',
            sourceChecksum: 'sha256:legacy',
          },
        ],
        nodes: [
          {
            nodeId: 'legacy-node-1',
            sourceId: 'legacy-source-1',
            nodeType: 'section',
            logicalRef: 'Section 1.1',
            title: 'Legacy section',
            text: 'Legacy section text.',
            pageRange: '4-5',
            headingPath: ['NBC 2025', 'Section 1.1 Legacy section'],
            parentNodeId: null,
            childNodeIds: [],
          },
        ],
        vectors: undefined,
      })
    );
    fs.writeFileSync(path.join(tempRoot, 'vectors.json'), JSON.stringify({ version: 1, vectors: [] }));

    const loaded = await loadBuildingCodeIndex(tempRoot);

    expect(loaded.sources[0]).toMatchObject({
      sourceId: 'legacy-source-1',
      documentId: 'legacy-source-1',
      localSourcePath: '',
    });
    expect(loaded.nodes[0]).toMatchObject({
      nodeId: 'legacy-node-1',
      documentId: 'legacy-source-1',
      extractionConfidence: 1,
      parser: {
        name: 'fixture',
        version: 'test-fixture',
        sourceElementIds: [],
        pageRange: '4-5',
        boundingBoxes: [],
      },
    });
  });

  it('normalizes legacy table row and note citations with provenance defaults', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);

    fs.writeFileSync(
      path.join(tempRoot, 'index.json'),
      JSON.stringify({
        ...minimalIndex(),
        sources: [
          {
            sourceId: 'legacy-source-1',
            codeFamily: 'NBC',
            edition: '2025',
            jurisdictionScope: 'Canada',
            sourceTitle: 'Legacy NBC fixture',
            sourceUrl: 'fixture://nbc-2025-refrigerant-excerpt.md',
            sourceChecksum: 'sha256:legacy',
          },
        ],
        nodes: [
          {
            nodeId: 'legacy-table-node-1',
            sourceId: 'legacy-source-1',
            nodeType: 'table',
            logicalRef: 'Table 1.1',
            title: 'Legacy table',
            text: 'Legacy table text.',
            pageRange: '8',
            headingPath: ['NBC 2025', 'Table 1.1 Legacy table'],
            parentNodeId: null,
            childNodeIds: [],
            tableId: 'legacy-table-1',
          },
        ],
        tables: [
          {
            tableId: 'legacy-table-1',
            nodeId: 'legacy-table-node-1',
            caption: 'Legacy table',
            columns: ['Item', 'Value'],
            rows: [
              {
                rowId: 'row-1',
                cells: ['A', 'B'],
                citation: {
                  status: 'complete',
                  citationId: 'legacy-row-citation',
                  sourceId: 'legacy-source-1',
                  codeFamily: 'NBC',
                  edition: '2025',
                  jurisdictionScope: 'Canada',
                  sourceTitle: 'Legacy NBC fixture',
                  sourceUrl: 'fixture://nbc-2025-refrigerant-excerpt.md',
                  sourceChecksum: 'sha256:legacy',
                  logicalRef: 'Table 1.1, Row 1',
                  nodeType: 'table-row',
                  pageRange: '8',
                  headingPath: ['NBC 2025', 'Table 1.1 Legacy table'],
                  displayCitation: 'NBC 2025, Table 1.1, Row 1',
                },
              },
            ],
            notes: [
              {
                noteId: 'note-a',
                text: 'Legacy note.',
                citation: {
                  status: 'partial',
                  citationId: 'legacy-note-citation',
                  sourceId: 'legacy-source-1',
                  codeFamily: 'NBC',
                  edition: '2025',
                  jurisdictionScope: 'Canada',
                  sourceTitle: 'Legacy NBC fixture',
                  sourceUrl: 'fixture://nbc-2025-refrigerant-excerpt.md',
                  sourceChecksum: 'sha256:legacy',
                  logicalRef: 'Table 1.1, Note a',
                  nodeType: 'table-note',
                  pageRange: '8',
                  headingPath: ['NBC 2025', 'Table 1.1 Legacy table'],
                  displayCitation: 'NBC 2025, Table 1.1, Note a',
                },
              },
            ],
          },
        ],
        vectors: undefined,
      })
    );
    fs.writeFileSync(path.join(tempRoot, 'vectors.json'), JSON.stringify({ version: 1, vectors: [] }));

    const loaded = await loadBuildingCodeIndex(tempRoot);
    const rowCitation = loaded.tables[0].rows[0].citation;
    const noteCitation = loaded.tables[0].notes[0].citation;

    expect(rowCitation).toMatchObject({
      citationId: 'legacy-row-citation',
      logicalRef: 'Table 1.1, Row 1',
      status: 'complete',
      nodeType: 'table-row',
      documentId: 'legacy-source-1',
      localSourcePath: '',
      extractionConfidence: 1,
      parser: {
        name: 'fixture',
        version: 'test-fixture',
        sourceElementIds: [],
        pageRange: '8',
        boundingBoxes: [],
      },
    });
    expect(noteCitation).toMatchObject({
      citationId: 'legacy-note-citation',
      logicalRef: 'Table 1.1, Note a',
      status: 'partial',
      nodeType: 'table-note',
      documentId: 'legacy-source-1',
      localSourcePath: '',
      extractionConfidence: 1,
      parser: {
        name: 'fixture',
        version: 'test-fixture',
        sourceElementIds: [],
        pageRange: '8',
        boundingBoxes: [],
      },
    });

    expect(() =>
      assertCitedEvidence({
        evidenceId: 'row-evidence',
        nodeId: 'legacy-table-node-1',
        evidenceKind: 'table-row',
        excerpt: loaded.tables[0].rows[0].cells.join(' | '),
        applicabilityNotes: [],
        citation: rowCitation,
      })
    ).not.toThrow();
    expect(() =>
      assertCitedEvidence({
        evidenceId: 'note-evidence',
        nodeId: 'legacy-table-node-1',
        evidenceKind: 'table-note',
        excerpt: loaded.tables[0].notes[0].text,
        applicabilityNotes: [],
        citation: noteCitation,
      })
    ).not.toThrow();
  });

  it('inherits LiteParse node provenance for table row and note citations with invalid provenance', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);

    const liteParseParser = {
      name: 'liteparse',
      version: '0.7.1',
      sourceElementIds: ['lp-table-1'],
      pageRange: '12',
      boundingBoxes: [
        {
          pageNumber: 12,
          x: 72,
          y: 144,
          width: 360,
          height: 120,
        },
      ],
    };

    fs.writeFileSync(
      path.join(tempRoot, 'index.json'),
      JSON.stringify({
        ...minimalIndex(),
        sources: [
          {
            sourceId: 'liteparse-source-1',
            documentId: 'liteparse-doc-1',
            codeFamily: 'NBC',
            edition: '2025',
            jurisdictionScope: 'Canada',
            sourceTitle: 'LiteParse NBC fixture',
            sourceUrl: 'https://example.test/nbc-liteparse.pdf',
            localSourcePath: 'fixtures/nbc-liteparse.pdf',
            sourceChecksum: 'sha256:liteparse',
          },
        ],
        nodes: [
          {
            nodeId: 'liteparse-table-node-1',
            sourceId: 'liteparse-source-1',
            documentId: 'liteparse-doc-1',
            nodeType: 'table',
            logicalRef: 'Table 6.2.1.1',
            title: 'LiteParse table',
            text: 'LiteParse table text.',
            pageRange: '12',
            headingPath: ['NBC 2025', 'Table 6.2.1.1 LiteParse table'],
            parentNodeId: null,
            childNodeIds: [],
            extractionConfidence: 0.93,
            parser: liteParseParser,
          },
        ],
        tables: [
          {
            tableId: 'liteparse-table-1',
            nodeId: 'liteparse-table-node-1',
            caption: 'LiteParse table',
            columns: ['Item', 'Value'],
            rows: [
              {
                rowId: 'liteparse-row-1',
                cells: ['A', 'B'],
                citation: {
                  status: 'complete',
                  citationId: 'liteparse-row-citation',
                  sourceId: 'liteparse-source-1',
                  documentId: 'liteparse-doc-1',
                  codeFamily: 'NBC',
                  edition: '2025',
                  jurisdictionScope: 'Canada',
                  sourceTitle: 'LiteParse NBC fixture',
                  sourceUrl: 'https://example.test/nbc-liteparse.pdf',
                  localSourcePath: 'fixtures/nbc-liteparse.pdf',
                  sourceChecksum: 'sha256:liteparse',
                  logicalRef: 'Table 6.2.1.1, Row 1',
                  nodeType: 'table-row',
                  pageRange: '12',
                  headingPath: ['NBC 2025', 'Table 6.2.1.1 LiteParse table'],
                  extractionConfidence: 0.93,
                  parser: {
                    name: 'docling',
                    version: 'missing-fields',
                  },
                  displayCitation: 'NBC 2025, Table 6.2.1.1, Row 1',
                },
              },
            ],
            notes: [
              {
                noteId: 'liteparse-note-a',
                text: 'LiteParse note.',
                citation: {
                  status: 'partial',
                  citationId: 'liteparse-note-citation',
                  sourceId: 'liteparse-source-1',
                  documentId: 'liteparse-doc-1',
                  codeFamily: 'NBC',
                  edition: '2025',
                  jurisdictionScope: 'Canada',
                  sourceTitle: 'LiteParse NBC fixture',
                  sourceUrl: 'https://example.test/nbc-liteparse.pdf',
                  localSourcePath: 'fixtures/nbc-liteparse.pdf',
                  sourceChecksum: 'sha256:liteparse',
                  logicalRef: 'Table 6.2.1.1, Note a',
                  nodeType: 'table-note',
                  pageRange: '12',
                  headingPath: ['NBC 2025', 'Table 6.2.1.1 LiteParse table'],
                  extractionConfidence: 0.93,
                  displayCitation: 'NBC 2025, Table 6.2.1.1, Note a',
                },
              },
            ],
          },
        ],
        vectors: undefined,
      })
    );
    fs.writeFileSync(path.join(tempRoot, 'vectors.json'), JSON.stringify({ version: 1, vectors: [] }));

    const loaded = await loadBuildingCodeIndex(tempRoot);

    expect(loaded.tables[0].rows[0].citation.parser).toEqual(liteParseParser);
    expect(loaded.tables[0].notes[0].citation.parser).toEqual(liteParseParser);
  });

  it('creates an empty active index with semantic search unavailable', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);

    const { createEmptyBuildingCodeIndex, isBuildingCodeIndexEmpty } = await import(
      '../src/main/mcp/building-code/index-store'
    );
    const index = createEmptyBuildingCodeIndex(['empty knowledge base']);

    expect(isBuildingCodeIndexEmpty(index)).toBe(true);
    expect(index.semanticSearchAvailable).toBe(false);
    await saveBuildingCodeIndex(tempRoot, index);
    await expect(loadBuildingCodeIndex(tempRoot)).resolves.toMatchObject({
      version: 1,
      semanticSearchAvailable: false,
      diagnostics: ['empty knowledge base'],
    });
  });

  it('does not replace the last good index when an atomic write fails before rename', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);
    await saveBuildingCodeIndex(tempRoot, minimalIndex());

    const badIndex = { ...minimalIndex(), version: 999 as 1 };
    await expect(saveBuildingCodeIndex(tempRoot, badIndex)).rejects.toThrow(
      'Unsupported building-code index version'
    );
    await expect(loadBuildingCodeIndex(tempRoot)).resolves.toEqual(minimalIndex());
  });

  it('restores the last good active index when publish fails after replacing index.json', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);
    const prior = minimalIndex();
    const next: BuildingCodeIndex = {
      ...minimalIndex(),
      nodes: [
        {
          nodeId: 'node-next',
          sourceId: 'source-next',
          documentId: 'doc-next',
          nodeType: 'section',
          logicalRef: 'Section 9.10.3.1',
          title: 'Next section',
          text: 'Next section text.',
          pageRange: '1',
          headingPath: ['Section 9.10.3.1 Next section'],
          parentNodeId: null,
          childNodeIds: [],
          extractionConfidence: 1,
          parser: {
            name: 'docling',
            version: '2.0.0',
            sourceElementIds: ['h1'],
            pageRange: '1',
            boundingBoxes: [],
          },
        },
      ],
      vectors: [
        {
          chunkId: 'chunk-next',
          embeddingModel: 'text-embedding-3-small',
          embedding: [0, 1],
          embeddingTextHash: 'sha256:next',
        },
      ],
      diagnostics: ['next diagnostic'],
    };

    await saveBuildingCodeIndex(tempRoot, prior);
    await expect(
      saveBuildingCodeIndex(tempRoot, next, {
        afterIndexFilePromoted: async () => {
          throw new Error('simulated publish interruption');
        },
      })
    ).rejects.toThrow('simulated publish interruption');

    await expect(loadBuildingCodeIndex(tempRoot)).resolves.toEqual(prior);
  });
});
