import { describe, expect, it } from 'vitest';
import { adaptDoclingToBuildingCodeIndex } from '../src/main/mcp/building-code/canonical-adapter';
import { detectBuildingCodeHeading } from '../src/main/mcp/building-code/heading-detector';
import type { NormalizedDoclingResult } from '../src/main/mcp/building-code/docling-parser';
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
      },
      { pageNumber: 2, text: 'Table 9.10.3.1 Ratings\nType | Rating\nWall | 1 h' },
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
      },
      {
        elementId: 'p1',
        kind: 'text',
        text: 'Fire separations shall comply with Table 9.10.3.1.',
        pageNumber: 1,
        level: null,
        confidence: 0.99,
        bbox: null,
      },
      {
        elementId: 't1',
        kind: 'table',
        text: 'Table 9.10.3.1 Ratings',
        pageNumber: 2,
        level: null,
        confidence: 0.96,
        bbox: null,
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
      },
    ],
    diagnostics: [],
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
});
