import { describe, expect, it } from 'vitest';
import { normalizeParserDocument } from '../src/main/mcp/building-code/parser-adapter';

describe('building-code parser-neutral adapter contract', () => {
  it('normalizes parser output with page provenance and parser diagnostics', () => {
    expect(
      normalizeParserDocument({
        parserName: 'liteparse',
        parserVersion: '2.0.0',
        pages: [
          {
            pageNumber: 1,
            text: 'Section 9.10.3.1 Fire separations',
            extractionMode: 'native',
            boundingBoxes: [{ x: 10, y: 20, width: 200, height: 16 }],
          },
        ],
        elements: [
          {
            elementId: 'lp-1-1',
            kind: 'heading',
            text: 'Section 9.10.3.1 Fire separations',
            pageNumber: 1,
            level: 2,
            confidence: 0.99,
            bbox: { x: 10, y: 20, width: 200, height: 16 },
            sourceIds: ['text-item-1'],
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
      })
    ).toEqual({
      parserName: 'liteparse',
      parserVersion: '2.0.0',
      pages: [
        {
          pageNumber: 1,
          text: 'Section 9.10.3.1 Fire separations',
          extractionMode: 'native',
          boundingBoxes: [{ x: 10, y: 20, width: 200, height: 16 }],
        },
      ],
      elements: [
        {
          elementId: 'lp-1-1',
          kind: 'heading',
          text: 'Section 9.10.3.1 Fire separations',
          pageNumber: 1,
          level: 2,
          confidence: 0.99,
          bbox: { x: 10, y: 20, width: 200, height: 16 },
          sourceIds: ['text-item-1'],
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
    });
  });

  it('rejects unsupported parser names', () => {
    expect(() =>
      normalizeParserDocument({
        parserName: 'unknown-parser',
        parserVersion: '1',
        pages: [],
        elements: [],
        tables: [],
        diagnostics: [],
        pageDiagnostics: [],
      })
    ).toThrow('Parser returned invalid result: parserName must be docling, liteparse, or fixture');
  });

  it('defaults absent optional arrays while rejecting malformed optional arrays', () => {
    expect(
      normalizeParserDocument({
        parserName: 'fixture',
        parserVersion: '1',
        pages: [{ pageNumber: 1, text: 'Section 1 Scope', extractionMode: 'native' }],
        elements: [
          {
            elementId: 'fixture-heading',
            kind: 'heading',
            text: 'Section 1 Scope',
            pageNumber: 1,
            level: 1,
            confidence: 1,
            bbox: null,
          },
        ],
        tables: [
          {
            elementId: 'fixture-table',
            caption: 'Table 1 Scope',
            pageNumber: 1,
            columns: [],
            rows: [],
            notes: [],
            confidence: 1,
          },
        ],
        diagnostics: [],
        pageDiagnostics: [],
      })
    ).toMatchObject({
      pages: [{ boundingBoxes: [] }],
      elements: [{ sourceIds: [] }],
      tables: [{ sourceIds: [] }],
    });

    expect(() =>
      normalizeParserDocument({
        parserName: 'fixture',
        parserVersion: '1',
        pages: [
          {
            pageNumber: 1,
            text: 'Section 1 Scope',
            extractionMode: 'native',
            boundingBoxes: 'not-array',
          },
        ],
        elements: [],
        tables: [],
        diagnostics: [],
        pageDiagnostics: [],
      })
    ).toThrow('Parser returned invalid result: pages[0].boundingBoxes must be an array');
  });
});
