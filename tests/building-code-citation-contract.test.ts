import { describe, expect, it } from 'vitest';
import {
  assertCitedEvidence,
  buildDisplayCitation,
  buildUnusableBuildingCodeResultMessage,
  wrapBuildingCodeEvidenceForModel,
} from '../src/main/mcp/building-code/citation';
import { buildCitation } from '../src/main/mcp/building-code/hierarchy';
import type {
  BuildingCodeEvidence,
  CitationStatus,
  CodeCitation,
  CodeNodeRecord,
  CodeNodeType,
  CodeSourceRecord,
} from '../src/main/mcp/building-code/types';

function citationFor(
  nodeType: CodeNodeType,
  logicalRef: string,
  status: CitationStatus = 'complete'
): CodeCitation {
  const base = {
    codeFamily: 'ASHRAE 15',
    edition: '2022',
    logicalRef,
  };

  return {
    status,
    citationId: `ashrae-15-2022-${logicalRef.toLowerCase().replace(/\W+/g, '-')}`,
    sourceId: 'ashrae-15-2022',
    documentId: 'doc-ashrae-15-2022',
    codeFamily: base.codeFamily,
    edition: base.edition,
    jurisdictionScope: 'model-code',
    sourceTitle: 'ASHRAE Standard 15-2022',
    sourceUrl: 'https://example.test/ashrae-15-2022',
    localSourcePath: 'C:/fixtures/ashrae-15-2022.pdf',
    sourceChecksum: 'sha256:example',
    logicalRef: base.logicalRef,
    nodeType,
    pageRange: '12',
    headingPath: ['Safety Standard for Refrigeration Systems', logicalRef],
    extractionConfidence: 1,
    parser: {
      name: 'fixture',
      version: 'test-fixture',
      sourceElementIds: ['section-7-2-1'],
      pageRange: '12',
      boundingBoxes: [],
    },
    displayCitation: buildDisplayCitation(base),
  };
}

const sectionEvidence: BuildingCodeEvidence = {
  evidenceId: 'evidence-section-7-2-1',
  nodeId: 'node-section-7-2-1',
  evidenceKind: 'section',
  excerpt: 'Refrigeration systems shall comply with this section.',
  fullText: 'Refrigeration systems shall comply with this section and related requirements.',
  applicabilityNotes: ['Applies to mechanical refrigeration systems.'],
  citation: citationFor('section', 'Section 7.2.1'),
};

describe('building-code citation contract', () => {
  it('formats deterministic display citations from code family, edition, and logical reference', () => {
    expect(
      buildDisplayCitation({
        codeFamily: 'ASHRAE 15',
        edition: '2022',
        logicalRef: 'Section 7.2.1',
      })
    ).toBe('ASHRAE 15 2022, Section 7.2.1');
  });

  it('requires cited evidence before model-facing use', () => {
    expect(() => assertCitedEvidence(sectionEvidence)).not.toThrow();

    const brokenEvidence = { ...sectionEvidence, citation: undefined };

    expect(() => assertCitedEvidence(brokenEvidence)).toThrow('citation');
  });

  it('rejects invalid citation and evidence enum values at runtime', () => {
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: { ...sectionEvidence.citation, status: 'draft' },
      })
    ).toThrow('citation.status');
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: { ...sectionEvidence.citation, nodeType: 'paragraph' },
      })
    ).toThrow('citation.nodeType');
    expect(() => assertCitedEvidence({ ...sectionEvidence, evidenceKind: 'figure' })).toThrow(
      'evidenceKind'
    );
  });

  it('rejects malformed citation and evidence array fields at runtime', () => {
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: { ...sectionEvidence.citation, headingPath: ['Chapter 7', 7] },
      })
    ).toThrow('citation.headingPath');
    expect(() =>
      assertCitedEvidence({ ...sectionEvidence, applicabilityNotes: ['Valid note', 15] })
    ).toThrow('applicabilityNotes');
  });

  it('rejects stale display citations that do not match canonical citation fields', () => {
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: {
          ...sectionEvidence.citation,
          displayCitation: 'ASHRAE 15 2019, Section 7.2.1',
        },
      })
    ).toThrow('citation.displayCitation');
  });

  it('requires uploaded document provenance on citations at runtime', () => {
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: { ...sectionEvidence.citation, documentId: undefined },
      })
    ).toThrow('citation.documentId');
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: { ...sectionEvidence.citation, localSourcePath: undefined },
      })
    ).toThrow('citation.localSourcePath');
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: { ...sectionEvidence.citation, extractionConfidence: undefined },
      })
    ).toThrow('citation.extractionConfidence');
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: { ...sectionEvidence.citation, parser: undefined },
      })
    ).toThrow('citation.parser');
  });

  it('rejects malformed parser provenance on citations at runtime', () => {
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: {
          ...sectionEvidence.citation,
          parser: { ...sectionEvidence.citation.parser, name: undefined },
        },
      })
    ).toThrow('citation.parser.name');
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: {
          ...sectionEvidence.citation,
          parser: { ...sectionEvidence.citation.parser, version: undefined },
        },
      })
    ).toThrow('citation.parser.version');
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: {
          ...sectionEvidence.citation,
          parser: { ...sectionEvidence.citation.parser, sourceElementIds: undefined },
        },
      })
    ).toThrow('citation.parser.sourceElementIds');
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: {
          ...sectionEvidence.citation,
          parser: { ...sectionEvidence.citation.parser, pageRange: undefined },
        },
      })
    ).toThrow('citation.parser.pageRange');
    expect(() =>
      assertCitedEvidence({
        ...sectionEvidence,
        citation: {
          ...sectionEvidence.citation,
          parser: { ...sectionEvidence.citation.parser, boundingBoxes: undefined },
        },
      })
    ).toThrow('citation.parser.boundingBoxes');
  });

  it('wraps cited evidence in a model-facing building-code evidence envelope', () => {
    const wrappedEvidence = wrapBuildingCodeEvidenceForModel([sectionEvidence]);

    expect(wrappedEvidence).toContain('<building_code_evidence>');
    expect(wrappedEvidence).not.toContain(sectionEvidence.citation.localSourcePath);
  });

  it('does not produce a valid-looking evidence envelope for empty evidence arrays', () => {
    expect(() => wrapBuildingCodeEvidenceForModel([])).toThrow('unusable');
  });

  it('can represent section, table row, table note, figure, appendix, definition, and partial page-level citation statuses', () => {
    const evidenceExamples: BuildingCodeEvidence[] = [
      sectionEvidence,
      {
        evidenceId: 'evidence-table-row-8-1-a',
        nodeId: 'node-table-8-1',
        evidenceKind: 'table-row',
        excerpt: 'A1 refrigerants have lower toxicity and no flame propagation.',
        applicabilityNotes: [],
        citation: citationFor('table-row', 'Table 8-1, Row A1'),
      },
      {
        evidenceId: 'evidence-table-note-8-1-a',
        nodeId: 'node-table-8-1',
        evidenceKind: 'table-note',
        excerpt: 'See related restrictions in the table notes.',
        applicabilityNotes: [],
        citation: citationFor('table-note', 'Table 8-1, Note a'),
      },
      {
        evidenceId: 'evidence-figure-1',
        nodeId: 'node-figure-1',
        evidenceKind: 'section',
        excerpt: 'Figure shows the decision path for occupancy classification.',
        applicabilityNotes: ['Figure evidence is cited by node type.'],
        citation: citationFor('figure', 'Figure 1'),
      },
      {
        evidenceId: 'evidence-appendix-a',
        nodeId: 'node-appendix-a',
        evidenceKind: 'section',
        excerpt: 'Appendix guidance clarifies informative examples.',
        applicabilityNotes: ['Appendix may be informative unless adopted.'],
        citation: citationFor('appendix', 'Appendix A'),
      },
      {
        evidenceId: 'evidence-definition-machinery-room',
        nodeId: 'node-definition-machinery-room',
        evidenceKind: 'section',
        excerpt: 'Machinery room means an enclosed space meeting the standard definition.',
        applicabilityNotes: [],
        citation: citationFor('definition', 'Definition: machinery room'),
      },
      {
        evidenceId: 'evidence-partial-page-45',
        nodeId: 'node-page-45',
        evidenceKind: 'section',
        excerpt: 'Page-level evidence must be marked partial until resolved to a canonical node.',
        applicabilityNotes: ['Candidate retrieval only until a precise node is identified.'],
        citation: citationFor('section', 'Page 45', 'partial'),
      },
    ];

    expect(evidenceExamples.map((evidence) => evidence.citation.nodeType)).toEqual([
      'section',
      'table-row',
      'table-note',
      'figure',
      'appendix',
      'definition',
      'section',
    ]);
    expect(evidenceExamples.at(-1)?.citation.status).toBe('partial');

    for (const evidence of evidenceExamples) {
      expect(() => assertCitedEvidence(evidence)).not.toThrow();
    }
  });

  it('builds a clear unusable-result message when no cited evidence can be returned', () => {
    expect(buildUnusableBuildingCodeResultMessage('missing canonical citation')).toContain(
      'unusable'
    );
    expect(buildUnusableBuildingCodeResultMessage('missing canonical citation')).toContain(
      'missing canonical citation'
    );
  });

  it('preserves uploaded document provenance on canonical evidence', () => {
    const source: CodeSourceRecord = {
      sourceId: 'source-doc-1',
      documentId: 'doc-1',
      codeFamily: 'NBC',
      edition: '2025',
      jurisdictionScope: 'Canada',
      sourceTitle: 'NBC 2025',
      sourceUrl: 'kb://building-code/doc-1/source.pdf',
      localSourcePath:
        'C:/Users/example/AppData/Roaming/MEP Lab/knowledge-base/building-code/sources/doc-1.pdf',
      sourceChecksum: 'sha256:abc',
    };
    const node: CodeNodeRecord = {
      nodeId: 'node-1',
      sourceId: source.sourceId,
      documentId: 'doc-1',
      nodeType: 'section',
      logicalRef: 'Section 9.10.3.1',
      title: 'Fire separations',
      text: 'See Table 9.10.3.1.',
      pageRange: '12-13',
      headingPath: ['NBC 2025', 'Section 9.10.3.1 Fire separations'],
      parentNodeId: null,
      childNodeIds: [],
      extractionConfidence: 0.97,
      parser: {
        name: 'docling',
        version: '2.0.0',
        sourceElementIds: ['page-12-block-3'],
        pageRange: '12-13',
        boundingBoxes: [{ pageNumber: 12, x: 10, y: 20, width: 300, height: 24 }],
      },
    };

    const citation = buildCitation(source, node);

    expect(citation.documentId).toBe('doc-1');
    expect(citation.localSourcePath).toBe(
      'C:/Users/example/AppData/Roaming/MEP Lab/knowledge-base/building-code/sources/doc-1.pdf'
    );
    expect(citation.sourceUrl).toBe('kb://building-code/doc-1/source.pdf');
    expect(citation.pageRange).toBe('12-13');
    expect(citation.extractionConfidence).toBe(0.97);
    expect(citation.parser).toEqual({
      name: 'docling',
      version: '2.0.0',
      sourceElementIds: ['page-12-block-3'],
      pageRange: '12-13',
      boundingBoxes: [{ pageNumber: 12, x: 10, y: 20, width: 300, height: 24 }],
    });
  });
});
