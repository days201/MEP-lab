import { describe, expect, it } from 'vitest';
import {
  normalizeMcpToolResultForModel,
  normalizeToolExecutionResultForUi,
} from '../src/main/claude/tool-result-utils';
import type { BuildingCodeEvidence } from '../src/main/mcp/building-code/types';

const citedEvidence: BuildingCodeEvidence = {
  evidenceId: 'evidence-section-7-2',
  nodeId: 'node-section-7-2',
  evidenceKind: 'section',
  excerpt: 'Class 2L refrigerants are treated as flammable refrigerants.',
  applicabilityNotes: ['Use with the referenced machinery-room provisions.'],
  citation: {
    status: 'complete',
    citationId: 'citation-section-7-2',
    sourceId: 'ashrae-15-2022',
    documentId: 'doc-ashrae-15-2022',
    codeFamily: 'ASHRAE 15',
    edition: '2022',
    jurisdictionScope: 'synthetic-fixture',
    sourceTitle: 'ASHRAE 15 2022 Synthetic Excerpt',
    sourceUrl: 'fixture://nbc-2025-refrigerant-excerpt.md',
    localSourcePath: 'fixture://nbc-2025-refrigerant-excerpt.md',
    sourceChecksum: 'sha256:fixture',
    logicalRef: 'Section 7.2',
    nodeType: 'section',
    pageRange: '1',
    headingPath: ['Section 7 Refrigerant Safety', 'Section 7.2 Refrigerant Classification'],
    extractionConfidence: 1,
    parser: {
      name: 'fixture',
      version: 'test-fixture',
      sourceElementIds: [],
      pageRange: '1',
      boundingBoxes: [],
    },
    displayCitation: 'ASHRAE 15 2022, Section 7.2',
  },
};

function mcpTextResult(value: unknown) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

describe('building-code runner result wrapper', () => {
  it('wraps cited Building_Code MCP results for model context', () => {
    const normalized = normalizeMcpToolResultForModel(
      mcpTextResult({ results: [citedEvidence], diagnostics: {} }),
      'mcp__Building_Code__search'
    );

    expect(normalized.text).toContain('<building_code_evidence>');
    expect(normalized.text).toContain('ASHRAE 15 2022, Section 7.2');
    expect(normalized.text).toContain('Class 2L refrigerants');
  });

  it('makes uncited Building_Code MCP results unusable without leaking raw text', () => {
    const uncitedResult = mcpTextResult({
      results: [
        {
          evidenceId: 'uncited',
          nodeId: 'orphan',
          evidenceKind: 'section',
          excerpt: 'uncited extracted text',
          applicabilityNotes: [],
        },
      ],
      diagnostics: {},
    });

    const normalized = normalizeMcpToolResultForModel(
      uncitedResult,
      'mcp__Building_Code__search'
    );

    expect(normalized.text).toContain('unusable');
    expect(normalized.text).not.toContain('uncited extracted text');
  });

  it('makes unparsable Building_Code MCP text unusable without echoing the payload', () => {
    const normalized = normalizeMcpToolResultForModel(
      {
        content: [
          {
            type: 'text',
            text: 'uncited extracted text',
          },
        ],
      },
      'mcp__Building_Code__search'
    );

    expect(normalized.text).toContain('unusable');
    expect(normalized.text).not.toContain('uncited extracted text');
  });

  it('applies the same Building_Code gate to UI tool results', () => {
    const normalized = normalizeToolExecutionResultForUi(
      mcpTextResult({ results: [citedEvidence], diagnostics: {} }),
      'mcp__Building_Code__read_section'
    );

    expect(normalized.content).toContain('<building_code_evidence>');
    expect(normalized.content).toContain('ASHRAE 15 2022, Section 7.2');
  });
});
