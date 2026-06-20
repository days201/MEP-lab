import { describe, expect, it } from 'vitest';
import {
  adaptDoclingToBuildingCodeIndex,
  adaptParserDocumentToBuildingCodeIndex,
} from '../src/main/mcp/building-code/canonical-adapter';
import { detectBuildingCodeHeading } from '../src/main/mcp/building-code/heading-detector';
import { buildStructuredTables } from '../src/main/mcp/building-code/table';
import type { NormalizedDoclingResult } from '../src/main/mcp/building-code/docling-parser';
import type { NormalizedParserDocument } from '../src/main/mcp/building-code/parser-adapter';
import type { CodeNodeRecord, CodeSourceRecord } from '../src/main/mcp/building-code/types';
import type { KnowledgeBaseDocumentRecord } from '../src/shared/ipc-types';

function documentRecord(): KnowledgeBaseDocumentRecord {
  return {
    documentId: 'doc-1',
    originalFilename: 'NBC.pdf',
    detectedFileType: 'pdf',
    mimeType: 'application/pdf',
    sourceChecksum: 'sha256:doc',
    sourcePath: '/tmp/NBC.pdf',
    sourceUri: 'kb://building-code/doc-1/NBC.pdf',
    parserName: 'docling',
    parserVersion: '2.0.0',
    status: 'parsing',
    uploadedAt: '2026-06-19T12:00:00.000Z',
    parseStartedAt: '2026-06-19T12:00:01.000Z',
    parseCompletedAt: null,
    lastIndexRebuildAt: null,
    metadata: {
      codeFamily: 'NBC',
      edition: '2025',
      jurisdictionScope: 'Canada',
      sourceTitle: 'NBC 2025',
    },
    diagnostics: [],
    failureMessage: null,
    indexSummary: {
      nodeCount: 0,
      tableCount: 0,
      chunkCount: 0,
      resolvedReferenceCount: 0,
      unresolvedReferenceCount: 0,
      sectionCount: 0,
      semanticSearchAvailable: false,
    },
  };
}

function parsedDocument(): NormalizedDoclingResult {
  return {
    parserName: 'docling',
    parserVersion: '2.0.0',
    pages: [
      {
        pageNumber: 1,
        text: 'Section 9.10.3.1 Fire separations\nFire separations shall comply with Table 9.10.3.1.',
        extractionMode: 'native',
        boundingBoxes: [],
      },
      {
        pageNumber: 2,
        text: 'Table 9.10.3.1 Ratings\nType | Rating\nWall | 1 h',
        extractionMode: 'native',
        boundingBoxes: [],
      },
    ],
    elements: [
      {
        elementId: 'h1',
        kind: 'heading',
        text: 'Section 9.10.3.1 Fire separations',
        pageNumber: 1,
        level: 2,
        confidence: 0.98,
        bbox: { x: 10, y: 10, width: 200, height: 24 },
        sourceIds: ['h1'],
      },
      {
        elementId: 'p1',
        kind: 'text',
        text: 'Fire separations shall comply with Table 9.10.3.1.',
        pageNumber: 1,
        level: null,
        confidence: 0.99,
        bbox: null,
        sourceIds: ['p1'],
      },
      {
        elementId: 't1',
        kind: 'table',
        text: 'Table 9.10.3.1 Ratings',
        pageNumber: 2,
        level: null,
        confidence: 0.96,
        bbox: null,
        sourceIds: ['t1'],
      },
    ],
    tables: [
      {
        elementId: 't1',
        caption: 'Table 9.10.3.1 Ratings',
        pageNumber: 2,
        columns: ['Type', 'Rating'],
        rows: [['Wall', '1 h']],
        notes: ['Note 1: Applies to fire separations.'],
        confidence: 0.96,
        sourceIds: ['t1'],
      },
    ],
    diagnostics: [],
    pageDiagnostics: [
      {
        pageNumber: 1,
        extractionMode: 'native',
        severity: 'info',
        message: 'Docling native extraction accepted',
        reasons: [],
      },
      {
        pageNumber: 2,
        extractionMode: 'native',
        severity: 'info',
        message: 'Docling native extraction accepted',
        reasons: [],
      },
    ],
  };
}

function sourceRecord(): CodeSourceRecord {
  return {
    sourceId: 'source-1',
    documentId: 'doc-1',
    codeFamily: 'NBC',
    edition: '2025',
    jurisdictionScope: 'Canada',
    sourceTitle: 'NBC 2025',
    sourceUrl: 'kb://building-code/doc-1/NBC.pdf',
    localSourcePath: '/tmp/NBC.pdf',
    sourceChecksum: 'sha256:doc',
  };
}

function tableNode(overrides: Partial<CodeNodeRecord> = {}): CodeNodeRecord {
  return {
    nodeId: 'node-table-9-10-3-3',
    sourceId: 'source-1',
    documentId: 'doc-1',
    nodeType: 'table',
    logicalRef: 'Table 9.10.3.3',
    title: 'Door Ratings',
    text: 'Table 9.10.3.3 Door Ratings',
    pageRange: '2',
    headingPath: ['Table 9.10.3.3 Door Ratings'],
    parentNodeId: null,
    childNodeIds: [],
    extractionConfidence: 0.95,
    parser: {
      name: 'docling',
      version: '2.0.0',
      sourceElementIds: ['caption-heading'],
      pageRange: '2',
      boundingBoxes: [],
    },
    ...overrides,
  };
}

describe('building-code canonical adapter', () => {
  describe('detectBuildingCodeHeading', () => {
    it.each([
      ['Section 9.10.3.1 Fire separations', 'Section 9.10.3.1', 'Fire separations', 'section', 2],
      ['Section 9.10.3.1 fire separations', 'Section 9.10.3.1', 'fire separations', 'section', 2],
      ['Article 3.2.2.20. Sprinklers', 'Article 3.2.2.20', 'Sprinklers', 'section', 4],
      ['Sentence 9.10.3.1.(1) Application', 'Sentence 9.10.3.1.(1)', 'Application', 'section', 5],
      ['Subsection 4.1.5. Loads', 'Subsection 4.1.5', 'Loads', 'subsection', 3],
      ['Part 6 HVAC', 'Part 6', 'HVAC', 'section', 1],
      ['Chapter 5 Environmental Separation', 'Chapter 5', 'Environmental Separation', 'section', 1],
      ['Table 7.3.1 Refrigerants', 'Table 7.3.1', 'Refrigerants', 'table', 3],
      ['Figure 3.1.4 Diagram', 'Figure 3.1.4', 'Diagram', 'figure', 3],
      ['Appendix A Explanatory Material', 'Appendix A', 'Explanatory Material', 'appendix', 1],
      ['Note A-3.2.1. Fire-resistance ratings', 'Note A-3.2.1', 'Fire-resistance ratings', 'note', 4],
      ['9.10.3.1 Fire separations', 'Section 9.10.3.1', 'Fire separations', 'section', 4],
      ['Section 3.4.1 Means of Egress', 'Section 3.4.1', 'Means of Egress', 'section', 2],
    ])('detects %s', (text, logicalRef, title, nodeType, level) => {
      expect(detectBuildingCodeHeading(text)).toMatchObject({ logicalRef, title, nodeType, level });
    });

    it('detects all-caps part headings without inventing a logical ref', () => {
      expect(detectBuildingCodeHeading('PART 3 FIRE PROTECTION')).toMatchObject({
        logicalRef: 'Part 3',
        title: 'FIRE PROTECTION',
        nodeType: 'section',
        level: 1,
      });
    });

    it('ignores ordinary body text', () => {
      expect(detectBuildingCodeHeading('This sentence references Section 9.10.3.1 in prose.')).toBeNull();
    });

    it.each([
      'Section 9.10.3.1 applies to fire separations.',
      'Article 3.2.2.20. requires sprinklers in this condition.',
      'Part 6 applies to HVAC systems.',
      '9.10.3.1 applies to fire separations.',
      'Section 9.10.3.1 and Section 9.10.3.2 apply to fire separations.',
    ])('ignores body prose that starts with a reference: %s', (text) => {
      expect(detectBuildingCodeHeading(text)).toBeNull();
    });
  });

  it('maps Docling output into canonical source, nodes, tables, chunks, and references', () => {
    const index = adaptDoclingToBuildingCodeIndex(parsedDocument(), documentRecord());

    expect(index.sources).toHaveLength(1);
    expect(index.sources[0]).toMatchObject({
      documentId: 'doc-1',
      sourceUrl: 'kb://building-code/doc-1/NBC.pdf',
      localSourcePath: '/tmp/NBC.pdf',
    });
    expect(index.nodes.map((node) => node.logicalRef)).toEqual([
      'Section 9.10.3.1',
      'Table 9.10.3.1',
    ]);
    expect(index.tables[0]).toMatchObject({
      caption: 'Table 9.10.3.1 Ratings',
      columns: ['Type', 'Rating'],
    });
    expect(index.crossReferences).toContainEqual(
      expect.objectContaining({
        rawText: 'Table 9.10.3.1',
        targetLogicalRef: 'Table 9.10.3.1',
        status: 'resolved',
      })
    );
    expect(index.chunks.length).toBeGreaterThan(0);
  });

  it('associates structured tables to caption-derived table nodes instead of the current section', () => {
    const index = adaptDoclingToBuildingCodeIndex(
      {
        ...parsedDocument(),
        elements: [
          parsedDocument().elements[0],
          {
            elementId: 'body-table',
            kind: 'table',
            text: 'Type | Rating\nWall | 1 h',
            pageNumber: 2,
            level: null,
            confidence: 0.94,
            bbox: { x: 20, y: 80, width: 300, height: 120 },
            sourceIds: ['body-table'],
          },
        ],
        tables: [
          {
            elementId: 'body-table',
            caption: 'Table 9.10.3.2 Occupancy Ratings',
            pageNumber: 2,
            columns: ['Type', 'Rating'],
            rows: [['Wall', '1 h']],
            notes: ['Note 1: Applies to major occupancies.'],
            confidence: 0.94,
            sourceIds: ['body-table'],
          },
        ],
      },
      documentRecord()
    );

    const sectionNode = index.nodes.find((node) => node.logicalRef === 'Section 9.10.3.1');
    const tableNode = index.nodes.find((node) => node.logicalRef === 'Table 9.10.3.2');
    const table = index.tables.find((record) => record.caption === 'Table 9.10.3.2 Occupancy Ratings');

    expect(sectionNode).toMatchObject({ nodeType: 'section' });
    expect(sectionNode).not.toHaveProperty('tableId');
    expect(tableNode).toMatchObject({
      nodeType: 'table',
      parser: {
        version: '2.0.0',
        sourceElementIds: expect.arrayContaining(['body-table']),
      },
    });
    expect(table).toMatchObject({
      nodeId: tableNode?.nodeId,
      columns: ['Type', 'Rating'],
    });
    expect(tableNode?.tableId).toBe(table?.tableId);
  });

  it('keeps structured tables and extracts markdown tables for unmatched table nodes', () => {
    const index = adaptDoclingToBuildingCodeIndex(
      {
        ...parsedDocument(),
        elements: [
          {
            ...parsedDocument().elements[0],
            text: 'Section 9.10.3.1 Fire separations',
          },
          {
            elementId: 'matched-heading',
            kind: 'table',
            text: 'Table 9.10.3.1 Ratings',
            pageNumber: 2,
            level: null,
            confidence: 0.96,
            bbox: null,
            sourceIds: ['matched-heading'],
          },
          {
            elementId: 'unmatched-heading',
            kind: 'heading',
            text: 'Table 9.10.3.2 Door Ratings',
            pageNumber: 3,
            level: null,
            confidence: 0.95,
            bbox: null,
            sourceIds: ['unmatched-heading'],
          },
          {
            elementId: 'unmatched-markdown',
            kind: 'table',
            text: '| Door | Rating |\n| --- | --- |\n| Suite door | 45 min |\nNote 1: Applies to dwelling units.',
            pageNumber: 3,
            level: null,
            confidence: 0.93,
            bbox: null,
            sourceIds: ['unmatched-markdown'],
          },
        ],
        tables: [
          {
            elementId: 'matched-heading',
            caption: 'Table 9.10.3.1 Ratings',
            pageNumber: 2,
            columns: ['Type', 'Rating'],
            rows: [['Wall', '1 h']],
            notes: [],
            confidence: 0.96,
            sourceIds: ['matched-heading'],
          },
        ],
      },
      documentRecord()
    );

    const matchedNode = index.nodes.find((node) => node.logicalRef === 'Table 9.10.3.1');
    const unmatchedNode = index.nodes.find((node) => node.logicalRef === 'Table 9.10.3.2');
    const matchedTable = index.tables.find((table) => table.nodeId === matchedNode?.nodeId);
    const unmatchedTable = index.tables.find((table) => table.nodeId === unmatchedNode?.nodeId);

    expect(index.tables).toHaveLength(2);
    expect(matchedNode).toMatchObject({ nodeType: 'table' });
    expect(unmatchedNode).toMatchObject({ nodeType: 'table' });
    expect(matchedTable).toMatchObject({
      caption: 'Table 9.10.3.1 Ratings',
      columns: ['Type', 'Rating'],
    });
    expect(unmatchedTable).toMatchObject({
      caption: 'Door Ratings',
      columns: ['Door', 'Rating'],
      rows: [expect.objectContaining({ cells: ['Suite door', '45 min'] })],
      notes: [expect.objectContaining({ text: 'Note 1: Applies to dwelling units.' })],
    });
    expect(matchedNode?.tableId).toBe(matchedTable?.tableId);
    expect(unmatchedNode?.tableId).toBe(unmatchedTable?.tableId);
  });

  it('matches structured tables to table nodes by caption logical ref when element ids differ', () => {
    const nodes = [tableNode()];

    const tables = buildStructuredTables(
      nodes,
      [
        {
          elementId: 'docling-table-body',
          caption: 'Table 9.10.3.3 Door Ratings',
          pageNumber: 2,
          columns: ['Door', 'Rating'],
          rows: [['Suite door', '45 min']],
          notes: [],
          confidence: 0.94,
          sourceIds: ['docling-table-body'],
        },
      ],
      sourceRecord()
    );

    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({
      nodeId: nodes[0].nodeId,
      caption: 'Table 9.10.3.3 Door Ratings',
      columns: ['Door', 'Rating'],
    });
    expect(nodes[0].parser.sourceElementIds).toContain('docling-table-body');
    expect(nodes[0].tableId).toBe(tables[0].tableId);
  });

  it('uses the parsed Docling parser version for node provenance', () => {
    const index = adaptDoclingToBuildingCodeIndex(
      {
        ...parsedDocument(),
        parserVersion: '2.1.4-docling',
      },
      {
        ...documentRecord(),
        parserVersion: 'queued-record-version',
      }
    );

    expect(index.nodes.map((node) => node.parser.version)).toEqual([
      '2.1.4-docling',
      '2.1.4-docling',
    ]);
  });

  it('uses LiteParse parser provenance from parser-neutral documents', () => {
    const parsed: NormalizedParserDocument = {
      parserName: 'liteparse',
      parserVersion: '2.0.0-liteparse',
      pages: [
        {
          pageNumber: 1,
          text: 'Section 9.10.3.1 Fire separations\nFire separations shall comply.',
          extractionMode: 'native',
          boundingBoxes: [{ x: 10, y: 20, width: 200, height: 16 }],
        },
      ],
      elements: [
        {
          elementId: 'lp-heading-1',
          kind: 'heading',
          text: 'Section 9.10.3.1 Fire separations',
          pageNumber: 1,
          level: 2,
          confidence: 0.99,
          bbox: { x: 10, y: 20, width: 200, height: 16 },
          sourceIds: ['text-item-1'],
        },
        {
          elementId: 'lp-body-1',
          kind: 'text',
          text: 'Fire separations shall comply.',
          pageNumber: 1,
          level: null,
          confidence: 0.97,
          bbox: null,
          sourceIds: ['text-item-2'],
        },
      ],
      tables: [],
      diagnostics: ['Parsed 1 pages. OCR used on 0 pages.'],
      pageDiagnostics: [
        {
          pageNumber: 1,
          extractionMode: 'native',
          severity: 'info',
          message: 'Native extraction accepted',
          reasons: [],
        },
      ],
    };

    const index = adaptParserDocumentToBuildingCodeIndex(parsed, {
      ...documentRecord(),
      parserName: 'docling',
      parserVersion: 'queued-record-version',
    });

    expect(index.nodes.map((node) => node.parser.name)).toEqual(['liteparse']);
    expect(index.nodes.map((node) => node.parser.version)).toEqual(['2.0.0-liteparse']);
  });

  it('preserves bounding boxes from content elements attached to the current node', () => {
    const index = adaptDoclingToBuildingCodeIndex(
      {
        ...parsedDocument(),
        elements: [
          ...parsedDocument().elements.slice(0, 1),
          {
            ...parsedDocument().elements[1],
            bbox: { x: 12, y: 44, width: 240, height: 36 },
          },
        ],
        tables: [],
      },
      documentRecord()
    );

    expect(index.nodes[0].parser.boundingBoxes).toContainEqual({
      pageNumber: 1,
      x: 12,
      y: 44,
      width: 240,
      height: 36,
    });
  });

  it('preserves the Docling table bbox on caption-created table nodes', () => {
    const index = adaptDoclingToBuildingCodeIndex(
      {
        ...parsedDocument(),
        elements: [
          parsedDocument().elements[0],
          {
            elementId: 'captioned-table-body',
            kind: 'table',
            text: 'Door | Rating\nSuite door | 45 min',
            pageNumber: 2,
            level: null,
            confidence: 0.94,
            bbox: { x: 24, y: 88, width: 320, height: 140 },
            sourceIds: ['captioned-table-body'],
          },
        ],
        tables: [
          {
            elementId: 'captioned-table-body',
            caption: 'Table 9.10.3.4 Door Ratings',
            pageNumber: 2,
            columns: ['Door', 'Rating'],
            rows: [['Suite door', '45 min']],
            notes: [],
            confidence: 0.94,
            sourceIds: ['captioned-table-body'],
          },
        ],
      },
      documentRecord()
    );

    const tableNode = index.nodes.find((node) => node.logicalRef === 'Table 9.10.3.4');

    expect(tableNode).toMatchObject({ nodeType: 'table' });
    expect(tableNode?.parser.boundingBoxes).toContainEqual({
      pageNumber: 2,
      x: 24,
      y: 88,
      width: 320,
      height: 140,
    });
  });

  it('reflects the lowest confidence from content elements attached to the current node', () => {
    const index = adaptDoclingToBuildingCodeIndex(
      {
        ...parsedDocument(),
        elements: [
          ...parsedDocument().elements.slice(0, 1),
          {
            ...parsedDocument().elements[1],
            confidence: 0.72,
          },
        ],
        tables: [],
      },
      documentRecord()
    );

    expect(index.nodes[0].extractionConfidence).toBe(0.72);
  });

  it('fails documents with no canonical building-code headings', () => {
    expect(() =>
      adaptDoclingToBuildingCodeIndex(
        {
          ...parsedDocument(),
          elements: [
            { ...parsedDocument().elements[1], text: 'General prose without canonical headings' },
          ],
          tables: [],
        },
        documentRecord()
      )
    ).toThrow('no canonical building-code sections found');
  });

  it('fails table-only documents with no structural building-code headings', () => {
    expect(() =>
      adaptDoclingToBuildingCodeIndex(
        {
          ...parsedDocument(),
          pages: [
            {
              pageNumber: 1,
              text: 'Overview\nTable 9.10.3.1 Ratings\nType | Rating\nWall | 1 h',
              extractionMode: 'native',
              boundingBoxes: [],
            },
          ],
          elements: [
            {
              elementId: 'intro',
              kind: 'text',
              text: 'Overview material without canonical headings',
              pageNumber: 1,
              level: null,
              confidence: 0.99,
              bbox: null,
              sourceIds: ['intro'],
            },
            {
              elementId: 'table-body',
              kind: 'table',
              text: 'Type | Rating\nWall | 1 h',
              pageNumber: 1,
              level: null,
              confidence: 0.96,
              bbox: null,
              sourceIds: ['table-body'],
            },
          ],
          tables: [
            {
              elementId: 'table-body',
              caption: 'Table 9.10.3.1 Ratings',
              pageNumber: 1,
              columns: ['Type', 'Rating'],
              rows: [['Wall', '1 h']],
              notes: [],
              confidence: 0.96,
              sourceIds: ['table-body'],
            },
          ],
        },
        documentRecord()
      )
    ).toThrow('no canonical building-code sections found');
  });
});
