import { describe, expect, it } from 'vitest';
import {
  computeLiteParseOcrWorkerCount,
  mergeLiteParseOcrPages,
  normalizeLiteParseResult,
  parseDocumentWithLiteParse,
  targetPagesFromPageNumbers,
  type LiteParseExecutor,
  type LiteParseOptions,
} from '../src/main/mcp/building-code/liteparse-adapter';

function litePage(pageNum: number, text: string, textItems: unknown[] = []): unknown {
  return {
    pageNum,
    width: 612,
    height: 792,
    text,
    textItems,
  };
}

function textItem(text: string, x: number, y: number, width: number, height: number): unknown {
  return {
    text,
    x,
    y,
    width,
    height,
    confidence: 0.9,
  };
}

describe('building-code LiteParse adapter', () => {
  it('normalizes LiteParse pages, text items, bounding boxes, headings, and tables', () => {
    const document = normalizeLiteParseResult({
      parserVersion: '2.1.2',
      pages: [
        litePage(1, 'Section 9.10.3.1 Fire separations\nTable 9.10.3.1 Ratings', [
          textItem('Section 9.10.3.1 Fire separations', 10, 20, 240, 18),
          textItem('Table 9.10.3.1 Ratings', 10, 52, 180, 14),
          textItem('Wall | Rating', 10, 70, 120, 12),
        ]),
      ],
    });

    expect(document).toEqual({
      parserName: 'liteparse',
      parserVersion: '2.1.2',
      pages: [
        {
          pageNumber: 1,
          text: 'Section 9.10.3.1 Fire separations\nTable 9.10.3.1 Ratings',
          extractionMode: 'native',
          boundingBoxes: [
            { x: 10, y: 20, width: 240, height: 18 },
            { x: 10, y: 52, width: 180, height: 14 },
            { x: 10, y: 70, width: 120, height: 12 },
          ],
        },
      ],
      elements: [
        {
          elementId: 'liteparse-page-1-item-1',
          kind: 'heading',
          text: 'Section 9.10.3.1 Fire separations',
          pageNumber: 1,
          level: 2,
          confidence: 0.9,
          bbox: { x: 10, y: 20, width: 240, height: 18 },
          sourceIds: ['page-1-item-1'],
        },
        {
          elementId: 'liteparse-page-1-item-2',
          kind: 'table',
          text: 'Table 9.10.3.1 Ratings',
          pageNumber: 1,
          level: null,
          confidence: 0.9,
          bbox: { x: 10, y: 52, width: 180, height: 14 },
          sourceIds: ['page-1-item-2'],
        },
        {
          elementId: 'liteparse-page-1-item-3',
          kind: 'table',
          text: 'Wall | Rating',
          pageNumber: 1,
          level: null,
          confidence: 0.9,
          bbox: { x: 10, y: 70, width: 120, height: 12 },
          sourceIds: ['page-1-item-3'],
        },
      ],
      tables: [
        {
          elementId: 'liteparse-page-1-item-2',
          caption: 'Table 9.10.3.1 Ratings',
          pageNumber: 1,
          columns: [],
          rows: [],
          notes: [],
          confidence: 0.9,
          sourceIds: ['page-1-item-2'],
        },
        {
          elementId: 'liteparse-page-1-item-3',
          caption: 'Wall | Rating',
          pageNumber: 1,
          columns: ['Wall', 'Rating'],
          rows: [],
          notes: [],
          confidence: 0.9,
          sourceIds: ['page-1-item-3'],
        },
      ],
      diagnostics: [],
      pageDiagnostics: [],
    });
  });

  it('compresses target page numbers for LiteParse OCR calls', () => {
    expect(targetPagesFromPageNumbers([5, 1, 2, 4, 9])).toBe('1-2,4-5,9');
  });

  it('preserves native page content and appends OCR content for selected suspicious pages', () => {
    const nativeDocument = normalizeLiteParseResult({
      parserVersion: '2.1.2',
      pages: [
        litePage(1, 'Section 1 Scope has enough native text for acceptance.', [
          textItem('Section 1 Scope', 10, 20, 100, 14),
        ]),
        litePage(2, 'Scan', [textItem('Scan', 10, 20, 40, 12)]),
      ],
    });
    const ocrDocument = normalizeLiteParseResult(
      {
        parserVersion: '2.1.2',
        pages: [
          litePage(2, 'Article 2.1.1.1 OCR recovered requirement text.', [
            textItem('Article 2.1.1.1 OCR recovered requirement text.', 12, 24, 300, 14),
          ]),
        ],
      },
      { extractionMode: 'ocr' }
    );

    const merged = mergeLiteParseOcrPages(nativeDocument, ocrDocument, [2]);

    expect(merged.pages.map((page) => page.extractionMode)).toEqual(['native', 'native_plus_ocr']);
    expect(merged.pages[0].text).toBe('Section 1 Scope has enough native text for acceptance.');
    expect(merged.pages[1].text).toBe('Scan\nArticle 2.1.1.1 OCR recovered requirement text.');
    expect(merged.pages[1].boundingBoxes).toEqual([
      { x: 10, y: 20, width: 40, height: 12 },
      { x: 12, y: 24, width: 300, height: 14 },
    ]);
    expect(merged.elements.map((element) => element.pageNumber)).toEqual([1, 2, 2]);
    expect(merged.elements[1]).toMatchObject({
      elementId: 'liteparse-page-2-item-1',
      text: 'Scan',
      pageNumber: 2,
    });
    expect(merged.elements[2]).toMatchObject({
      text: 'Article 2.1.1.1 OCR recovered requirement text.',
      pageNumber: 2,
    });
  });

  it('preserves native non-text content and merges OCR when native page text is empty', () => {
    const nativeDocument = normalizeLiteParseResult({
      parserVersion: '2.1.2',
      pages: [
        litePage(1, '', [
          textItem('Table 9.10.3.1 Ratings', 10, 20, 180, 14),
          textItem('Wall | Rating', 10, 44, 120, 12),
        ]),
      ],
    });
    const ocrDocument = normalizeLiteParseResult(
      {
        parserVersion: '2.1.2',
        pages: [
          litePage(1, 'Article 9.10.3.1 OCR recovered text.', [
            textItem('Article 9.10.3.1 OCR recovered text.', 12, 70, 260, 14),
          ]),
        ],
      },
      { extractionMode: 'ocr' }
    );

    const merged = mergeLiteParseOcrPages(nativeDocument, ocrDocument, [1]);

    expect(merged.pages[0]).toMatchObject({
      pageNumber: 1,
      text: 'Article 9.10.3.1 OCR recovered text.',
      extractionMode: 'native_plus_ocr',
    });
    expect(merged.pages[0].boundingBoxes).toEqual([
      { x: 10, y: 20, width: 180, height: 14 },
      { x: 10, y: 44, width: 120, height: 12 },
      { x: 12, y: 70, width: 260, height: 14 },
    ]);
    expect(merged.elements.map((element) => element.text)).toEqual(
      expect.arrayContaining([
        'Table 9.10.3.1 Ratings',
        'Wall | Rating',
        'Article 9.10.3.1 OCR recovered text.',
      ])
    );
    expect(merged.elements).toHaveLength(3);
    expect(merged.tables.map((table) => table.caption)).toEqual([
      'Table 9.10.3.1 Ratings',
      'Wall | Rating',
    ]);
  });

  it('continues with native extraction when OCR batch and page fallback fail', async () => {
    const calls: LiteParseOptions[] = [];
    const executor: LiteParseExecutor = async ({ options }) => {
      calls.push(options);

      if (!options.ocrEnabled) {
        return {
          parserVersion: '2.1.2',
          pages: [
            litePage(
              1,
              'Section 1.1 Scope provisions apply to this document and contain enough native code words for acceptance.',
              [textItem('Section 1.1 Scope provisions apply to this document', 10, 20, 320, 14)]
            ),
            litePage(2, 'Scan', [textItem('Scan', 10, 20, 35, 12)]),
            litePage(
              3,
              'Article 3.1.1.1 Native text remains acceptable on this later page with enough content.',
              [textItem('Article 3.1.1.1 Native text remains acceptable', 10, 20, 320, 14)]
            ),
          ],
        };
      }

      throw new Error('missing tessdata');
    };

    const document = await parseDocumentWithLiteParse({
      filePath: 'C:\\codes\\nbc.pdf',
      executor,
      logicalCoreCount: 4,
    });

    expect(calls).toEqual([
      expect.objectContaining({ ocrEnabled: false }),
      expect.objectContaining({ ocrEnabled: true, targetPages: '2', numWorkers: 2 }),
      expect.objectContaining({ ocrEnabled: true, targetPages: '2', numWorkers: 1 }),
    ]);
    expect(document.pages[1]).toMatchObject({
      pageNumber: 2,
      text: 'Scan',
      extractionMode: 'native',
    });
    expect(document.diagnostics).toContain('OCR batch failed: missing tessdata');
    expect(document.diagnostics).toContain('OCR failed for page 2: missing tessdata');
    expect(document.diagnostics).toContain('Parsed 3 pages. OCR used on 0 pages.');
    expect(document.pageDiagnostics.find((item) => item.pageNumber === 2)).toMatchObject({
      severity: 'warning',
      reasons: expect.arrayContaining(['nearby code page has unexpectedly low native text']),
    });
  });

  it('runs selective OCR for suspicious pages and reports parser progress', async () => {
    const progressMessages: string[] = [];
    const executor: LiteParseExecutor = async ({ options }) => {
      if (!options.ocrEnabled) {
        return {
          parserVersion: '2.1.2',
          pages: [
            litePage(
              1,
              'Section 1.1 Scope provisions apply to this document and contain enough native code words for acceptance.',
              [textItem('Section 1.1 Scope provisions apply to this document', 10, 20, 320, 14)]
            ),
            litePage(2, 'Scan', [textItem('Scan', 10, 20, 35, 12)]),
          ],
        };
      }

      expect(options).toMatchObject({ targetPages: '2', numWorkers: 8 });
      return {
        parserVersion: '2.1.2',
        pages: [
          litePage(2, 'Article 2.1.1.1 OCR recovered the scanned requirement.', [
            textItem('Article 2.1.1.1 OCR recovered the scanned requirement.', 10, 20, 340, 14),
          ]),
        ],
      };
    };

    const document = await parseDocumentWithLiteParse({
      filePath: 'C:\\codes\\nbc.pdf',
      executor,
      logicalCoreCount: 16,
      onProgress: (progress) => {
        progressMessages.push(`${progress.phase}:${progress.message}`);
      },
    });

    expect(progressMessages).toEqual([
      'parsing:Parsing document with LiteParse native extraction.',
      'ocr:Running LiteParse OCR for 1 suspicious page.',
    ]);
    expect(document.pages[1]).toMatchObject({
      pageNumber: 2,
      text: 'Scan\nArticle 2.1.1.1 OCR recovered the scanned requirement.',
      extractionMode: 'native_plus_ocr',
    });
    expect(document.diagnostics).toContain('Parsed 2 pages. OCR used on 1 pages.');
  });

  it('diagnoses selected suspicious pages omitted from successful batch OCR results', async () => {
    const executor: LiteParseExecutor = async ({ options }) => {
      if (!options.ocrEnabled) {
        return {
          parserVersion: '2.1.2',
          pages: [
            litePage(
              1,
              'Section 1.1 Scope provisions apply to this document and contain enough native code words for acceptance.',
              [textItem('Section 1.1 Scope provisions apply to this document', 10, 20, 320, 14)]
            ),
            litePage(2, 'Scan', [textItem('Scan', 10, 20, 35, 12)]),
            litePage(3, 'Blur', [textItem('Blur', 10, 20, 35, 12)]),
          ],
        };
      }

      return {
        parserVersion: '2.1.2',
        pages: [
          litePage(2, 'Article 2.1.1.1 OCR recovered the scanned requirement.', [
            textItem('Article 2.1.1.1 OCR recovered the scanned requirement.', 10, 20, 340, 14),
          ]),
        ],
      };
    };

    const document = await parseDocumentWithLiteParse({
      filePath: 'C:\\codes\\nbc.pdf',
      executor,
      logicalCoreCount: 16,
    });

    expect(document.pages[1]).toMatchObject({
      pageNumber: 2,
      text: 'Scan\nArticle 2.1.1.1 OCR recovered the scanned requirement.',
      extractionMode: 'native_plus_ocr',
    });
    expect(document.pages[2]).toMatchObject({
      pageNumber: 3,
      text: 'Blur',
      extractionMode: 'native',
    });
    expect(document.diagnostics).toContain(
      'OCR produced no result for suspicious page 3; native extraction preserved.'
    );
  });

  it('does not count selected OCR pages that have no usable content', async () => {
    const executor: LiteParseExecutor = async ({ options }) => {
      if (!options.ocrEnabled) {
        return {
          parserVersion: '2.1.2',
          pages: [
            litePage(
              1,
              'Section 1.1 Scope provisions apply to this document and contain enough native code words for acceptance.',
              [textItem('Section 1.1 Scope provisions apply to this document', 10, 20, 320, 14)]
            ),
            litePage(2, 'Scan', [textItem('Scan', 10, 20, 35, 12)]),
          ],
        };
      }

      return {
        parserVersion: '2.1.2',
        pages: [litePage(2, '')],
      };
    };

    const document = await parseDocumentWithLiteParse({
      filePath: 'C:\\codes\\nbc.pdf',
      executor,
      logicalCoreCount: 16,
    });

    expect(document.pages[1]).toMatchObject({
      pageNumber: 2,
      text: 'Scan',
      extractionMode: 'native',
    });
    expect(document.diagnostics).toContain(
      'OCR produced no usable result for suspicious page 2; native extraction preserved.'
    );
    expect(document.diagnostics).toContain('Parsed 2 pages. OCR used on 0 pages.');
    expect(document.pageDiagnostics.find((item) => item.pageNumber === 2)).toMatchObject({
      extractionMode: 'native',
      severity: 'warning',
      message: 'LiteParse OCR produced no usable result; native extraction preserved',
    });
  });

  it('caps LiteParse OCR workers conservatively', () => {
    expect(computeLiteParseOcrWorkerCount(1)).toBe(1);
    expect(computeLiteParseOcrWorkerCount(4)).toBe(2);
    expect(computeLiteParseOcrWorkerCount(16)).toBe(8);
  });
});
