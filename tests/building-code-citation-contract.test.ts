import { describe, expect, it } from 'vitest';
import {
  assertCitedEvidence,
  buildDisplayCitation,
  buildUnusableBuildingCodeResultMessage,
  wrapBuildingCodeEvidenceForModel,
} from '../src/main/mcp/building-code/citation';
import type {
  BuildingCodeEvidence,
  CitationStatus,
  CodeCitation,
  CodeNodeType,
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
    codeFamily: base.codeFamily,
    edition: base.edition,
    jurisdictionScope: 'model-code',
    sourceTitle: 'ASHRAE Standard 15-2022',
    sourceUrl: 'https://example.test/ashrae-15-2022',
    sourceChecksum: 'sha256:example',
    logicalRef: base.logicalRef,
    nodeType,
    pageRange: '12',
    headingPath: ['Safety Standard for Refrigeration Systems', logicalRef],
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

  it('wraps cited evidence in a model-facing building-code evidence envelope', () => {
    expect(wrapBuildingCodeEvidenceForModel([sectionEvidence])).toContain(
      '<building_code_evidence>'
    );
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
});
