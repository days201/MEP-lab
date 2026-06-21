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

function customToolTextResult(text: string) {
  return {
    content: [
      {
        type: 'text',
        text,
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

  it('wraps LiteParse-backed Building_Code MCP evidence instead of marking it unusable', () => {
    const liteparseEvidence: BuildingCodeEvidence = {
      ...citedEvidence,
      citation: {
        ...citedEvidence.citation,
        parser: {
          name: 'liteparse',
          version: '2.0.0-liteparse',
          sourceElementIds: ['page-1-block-2'],
          pageRange: '1',
          boundingBoxes: [{ pageNumber: 1, x: 10, y: 20, width: 300, height: 24 }],
        },
      },
    };

    const normalized = normalizeMcpToolResultForModel(
      mcpTextResult({ results: [liteparseEvidence], diagnostics: {} }),
      'mcp__Building_Code__search'
    );

    expect(normalized.text).toContain('<building_code_evidence>');
    expect(normalized.text).toContain('ASHRAE 15 2022, Section 7.2');
    expect(normalized.text).not.toContain('unusable');
  });

  it('preserves model-normalized search evidence when the UI formats tool_execution_end', () => {
    const modelResult = normalizeMcpToolResultForModel(
      mcpTextResult({ results: [citedEvidence], diagnostics: {} }),
      'mcp__Building_Code__search'
    );

    const uiResult = normalizeToolExecutionResultForUi(
      customToolTextResult(modelResult.text),
      'mcp__Building_Code__search'
    );

    expect(uiResult.content).toBe(modelResult.text);
    expect(uiResult.content).toContain('<building_code_evidence>');
    expect(uiResult.content).not.toContain('tool result was not valid JSON');
  });

  it('preserves model-normalized read_section evidence when the UI formats tool_execution_end', () => {
    const modelResult = normalizeMcpToolResultForModel(
      mcpTextResult({ results: [citedEvidence], diagnostics: {} }),
      'mcp__Building_Code__read_section'
    );

    const uiResult = normalizeToolExecutionResultForUi(
      customToolTextResult(modelResult.text),
      'mcp__Building_Code__read_section'
    );

    expect(uiResult.content).toBe(modelResult.text);
    expect(uiResult.content).toContain('<building_code_evidence>');
    expect(uiResult.content).not.toContain('tool result was not valid JSON');
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

  it('preserves a zero-result response through the UI formatter', () => {
    const modelResult = normalizeMcpToolResultForModel(
      mcpTextResult({ results: [], diagnostics: {} }),
      'mcp__Building_Code__search'
    );

    const uiResult = normalizeToolExecutionResultForUi(
      customToolTextResult(modelResult.text),
      'mcp__Building_Code__search'
    );

    expect(modelResult.text).toContain('no cited evidence was provided');
    expect(uiResult.content).toBe(modelResult.text);
    expect(uiResult.content).not.toContain('tool result was not valid JSON');
  });

  it('surfaces structured MCP server errors and preserves them through UI formatting', () => {
    const modelResult = normalizeMcpToolResultForModel(
      mcpTextResult({
        error: true,
        message:
          'Building_Code semantic search is unavailable because embeddings are not available for the active index.',
        tool: 'search',
      }),
      'mcp__Building_Code__search'
    );

    const uiResult = normalizeToolExecutionResultForUi(
      customToolTextResult(modelResult.text),
      'mcp__Building_Code__search'
    );

    expect(modelResult.text).toContain('semantic search is unavailable');
    expect(modelResult.text).not.toContain('did not include canonical cited evidence results');
    expect(uiResult.content).toBe(modelResult.text);
    expect(uiResult.content).not.toContain('tool result was not valid JSON');
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
    expect(normalized.text).toContain('tool result was not valid JSON');
    expect(normalized.text).not.toContain('uncited extracted text');
  });

  it('applies the same Building_Code gate to raw UI tool results', () => {
    const normalized = normalizeToolExecutionResultForUi(
      mcpTextResult({ results: [citedEvidence], diagnostics: {} }),
      'mcp__Building_Code__read_section'
    );

    expect(normalized.content).toContain('<building_code_evidence>');
    expect(normalized.content).toContain('ASHRAE 15 2022, Section 7.2');
  });
});
