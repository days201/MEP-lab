import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import {
  normalizeParserDocument,
  type NormalizedParserDocument,
  type NormalizedParserElement,
  type NormalizedParserPage,
  type NormalizedParserTable,
  type ParseDocumentProgress,
  type ParserExtractionMode,
  type ParserPageDiagnostic,
} from './parser-adapter';
import {
  hasExpectedCodePattern,
  scorePageExtractionQuality,
  type PageQualityScore,
} from './page-quality';

export interface LiteParseOptions {
  ocrEnabled?: boolean;
  ocrLanguage?: string;
  ocrServerUrl?: string;
  ocrServerHeaders?: Record<string, string>;
  tessdataPath?: string;
  maxPages?: number;
  targetPages?: string;
  dpi?: number;
  outputFormat?: 'json' | 'text' | 'markdown';
  imageMode?: 'off' | 'placeholder' | 'embed';
  extractLinks?: boolean;
  preserveVerySmallText?: boolean;
  password?: string;
  quiet?: boolean;
  numWorkers?: number;
}

export interface LiteParseExecutorInput {
  filePath: string;
  options: LiteParseOptions;
}

export type LiteParseExecutor = (input: LiteParseExecutorInput) => Promise<unknown>;

export interface ParseDocumentWithLiteParseInput {
  filePath: string;
  options?: LiteParseOptions;
  executor?: LiteParseExecutor;
  ocrPageBudget?: number;
  logicalCoreCount?: number;
  onProgress?: (progress: ParseDocumentProgress) => void | Promise<void>;
}

export type NormalizedLiteParseDocument = NormalizedParserDocument & { parserName: 'liteparse' };

interface NormalizeLiteParseOptions {
  extractionMode?: ParserExtractionMode;
  diagnostics?: string[];
  pageDiagnostics?: ParserPageDiagnostic[];
}

interface LiteParseTextItem {
  text: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  confidence?: number;
}

const DEFAULT_OCR_PAGE_BUDGET = 64;
const DEFAULT_LITEPARSE_VERSION = 'unknown';

export async function parseDocumentWithLiteParse(
  input: ParseDocumentWithLiteParseInput
): Promise<NormalizedLiteParseDocument> {
  const executor = input.executor ?? defaultLiteParseExecutor;
  const baseOptions: LiteParseOptions = {
    outputFormat: 'json',
    quiet: true,
    ...input.options,
  };

  await emitProgress(input.onProgress, {
    phase: 'parsing',
    message: 'Parsing document with LiteParse native extraction.',
    currentPage: null,
    totalPages: null,
    ocrPageCount: 0,
  });

  const nativeRaw = await executor({
    filePath: input.filePath,
    options: {
      ...baseOptions,
      ocrEnabled: false,
    },
  });
  const nativeDocument = normalizeLiteParseResult(nativeRaw);
  const qualityScores = scoreNativePages(nativeDocument);
  const allSuspiciousPages = qualityScores
    .filter((score) => score.suspicious)
    .map((score) => score.pageNumber);
  const ocrPageBudget = Math.max(0, input.ocrPageBudget ?? DEFAULT_OCR_PAGE_BUDGET);
  const suspiciousPages = allSuspiciousPages.slice(0, ocrPageBudget);
  const budgetSkippedPageNumbers = new Set(allSuspiciousPages.slice(ocrPageBudget));
  const budgetSkippedDiagnostics = Array.from(budgetSkippedPageNumbers).map(
    (pageNumber) => `OCR skipped for suspicious page ${pageNumber}: OCR page budget exhausted.`
  );
  const pageDiagnostics = markBudgetSkippedPageDiagnostics(
    pageDiagnosticsFromScores(qualityScores, nativeDocument.pages),
    budgetSkippedPageNumbers
  );

  if (suspiciousPages.length === 0) {
    return normalizeParserDocument({
      ...nativeDocument,
      diagnostics: [
        ...nativeDocument.diagnostics,
        ...budgetSkippedDiagnostics,
        `Parsed ${nativeDocument.pages.length} pages. OCR used on 0 pages.`,
      ],
      pageDiagnostics,
    }) as NormalizedLiteParseDocument;
  }

  await emitProgress(input.onProgress, {
    phase: 'ocr',
    message: `Running LiteParse OCR for ${suspiciousPages.length} suspicious ${
      suspiciousPages.length === 1 ? 'page' : 'pages'
    }.`,
    currentPage: null,
    totalPages: nativeDocument.pages.length,
    ocrPageCount: suspiciousPages.length,
  });

  const diagnostics = [...nativeDocument.diagnostics];
  const ocrOptions: LiteParseOptions = {
    ...baseOptions,
    ocrEnabled: true,
    targetPages: targetPagesFromPageNumbers(suspiciousPages),
    numWorkers: computeLiteParseOcrWorkerCount(input.logicalCoreCount ?? os.cpus().length),
  };

  let mergedDocument = nativeDocument;
  let successfulOcrPages = 0;
  const successfulOcrPageNumbers = new Set<number>();
  const omittedBatchOcrPageNumbers = new Set<number>();

  try {
    const ocrRaw = await executor({ filePath: input.filePath, options: ocrOptions });
    const ocrDocument = normalizeLiteParseResult(ocrRaw, { extractionMode: 'ocr' });
    mergedDocument = mergeLiteParseOcrPages(nativeDocument, ocrDocument, suspiciousPages);
    for (const pageNumber of mergedOcrPageNumbers(ocrDocument, suspiciousPages)) {
      successfulOcrPageNumbers.add(pageNumber);
    }
    successfulOcrPages = successfulOcrPageNumbers.size;
    for (const pageNumber of suspiciousPages) {
      if (!successfulOcrPageNumbers.has(pageNumber)) {
        omittedBatchOcrPageNumbers.add(pageNumber);
        diagnostics.push(
          `OCR produced no result for suspicious page ${pageNumber}; native extraction preserved.`
        );
      }
    }
  } catch (error) {
    diagnostics.push(`OCR batch failed: ${errorMessage(error)}`);
    for (const pageNumber of suspiciousPages) {
      try {
        const pageRaw = await executor({
          filePath: input.filePath,
          options: {
            ...ocrOptions,
            targetPages: targetPagesFromPageNumbers([pageNumber]),
            numWorkers: 1,
          },
        });
        const pageOcrDocument = normalizeLiteParseResult(pageRaw, { extractionMode: 'ocr' });
        mergedDocument = mergeLiteParseOcrPages(mergedDocument, pageOcrDocument, [pageNumber]);
        for (const mergedPageNumber of mergedOcrPageNumbers(pageOcrDocument, [pageNumber])) {
          successfulOcrPageNumbers.add(mergedPageNumber);
        }
        successfulOcrPages = successfulOcrPageNumbers.size;
      } catch (error) {
        diagnostics.push(`OCR failed for page ${pageNumber}: ${errorMessage(error)}`);
      }
    }
  }

  const updatedPageDiagnostics = pageDiagnostics.map((diagnostic) =>
    successfulOcrPageNumbers.has(diagnostic.pageNumber)
      ? {
          ...diagnostic,
          extractionMode: pageHadNativeText(nativeDocument, diagnostic.pageNumber)
            ? 'native_plus_ocr'
            : 'ocr',
          severity: 'info',
          message: 'LiteParse OCR merged for suspicious page',
        }
      : diagnostic
  ).map((diagnostic) =>
    omittedBatchOcrPageNumbers.has(diagnostic.pageNumber)
      ? {
          ...diagnostic,
          extractionMode: 'native',
          severity: 'warning',
          message: 'LiteParse OCR produced no result; native extraction preserved',
        }
      : diagnostic
  );

  return normalizeParserDocument({
    ...mergedDocument,
    diagnostics: [
      ...diagnostics,
      ...budgetSkippedDiagnostics,
      `Parsed ${nativeDocument.pages.length} pages. OCR used on ${successfulOcrPages} pages.`,
    ],
    pageDiagnostics: updatedPageDiagnostics,
  }) as NormalizedLiteParseDocument;
}

export function normalizeLiteParseResult(
  value: unknown,
  options: NormalizeLiteParseOptions = {}
): NormalizedLiteParseDocument {
  const record = asRecord(value);
  const pages = asArray(record.pages).map((page, index) =>
    normalizeLiteParsePage(page, index, options.extractionMode ?? 'native')
  );
  const elements = pages.flatMap((page, pageIndex) =>
    textItemsForPage(asArray(record.pages)[pageIndex], page.text).map((item, itemIndex) =>
      normalizeTextItemElement(item, page.pageNumber, itemIndex)
    )
  );

  return normalizeParserDocument({
    parserName: 'liteparse',
    parserVersion: asString(record.parserVersion, DEFAULT_LITEPARSE_VERSION),
    pages,
    elements,
    tables: elements.filter((element) => element.kind === 'table').map(tableFromElement),
    diagnostics: options.diagnostics ?? [],
    pageDiagnostics: options.pageDiagnostics ?? [],
  }) as NormalizedLiteParseDocument;
}

export function mergeLiteParseOcrPages(
  nativeDocument: NormalizedLiteParseDocument,
  ocrDocument: NormalizedLiteParseDocument,
  selectedPageNumbers: number[]
): NormalizedLiteParseDocument {
  const selectedPages = new Set(selectedPageNumbers);
  const ocrPagesByNumber = new Map(ocrDocument.pages.map((page) => [page.pageNumber, page]));

  const pages = nativeDocument.pages.map((nativePage) => {
    const ocrPage = ocrPagesByNumber.get(nativePage.pageNumber);
    if (!selectedPages.has(nativePage.pageNumber) || !ocrPage) {
      return nativePage;
    }

    if (nativePage.text.trim().length === 0) {
      return {
        ...ocrPage,
        extractionMode: 'ocr',
      };
    }

    return {
      ...nativePage,
      text: mergePageText(nativePage.text, ocrPage.text),
      extractionMode: 'native_plus_ocr',
      boundingBoxes: mergeBoundingBoxes(nativePage.boundingBoxes, ocrPage.boundingBoxes),
    };
  });

  const selectedPagesWithOcr = new Set(
    selectedPageNumbers.filter((pageNumber) => ocrPagesByNumber.has(pageNumber))
  );
  const nativeElementsByPage = groupByPageNumber(nativeDocument.elements);
  const ocrElementsByPage = groupByPageNumber(ocrDocument.elements);
  const nativeTablesByPage = groupByPageNumber(nativeDocument.tables);
  const ocrTablesByPage = groupByPageNumber(ocrDocument.tables);
  const ocrElementIdRemaps = new Map<string, string>();

  const elements = nativeDocument.pages
    .flatMap((page) => {
      const nativeElements = nativeElementsByPage.get(page.pageNumber) ?? [];
      if (!selectedPagesWithOcr.has(page.pageNumber)) {
        return nativeElements;
      }

      const ocrElements = ocrElementsByPage.get(page.pageNumber) ?? [];
      if (!pageHadNativeText(nativeDocument, page.pageNumber)) {
        for (const element of ocrElements) {
          ocrElementIdRemaps.set(
            elementIdentityKey(element.pageNumber, element.elementId),
            element.elementId
          );
        }
        return ocrElements;
      }

      return mergePageElements(nativeElements, ocrElements, ocrElementIdRemaps);
    })
    .sort(comparePageElementOrder);
  const tables = nativeDocument.pages
    .flatMap((page) => {
      const nativeTables = nativeTablesByPage.get(page.pageNumber) ?? [];
      if (!selectedPagesWithOcr.has(page.pageNumber)) {
        return nativeTables;
      }

      const ocrTables = (ocrTablesByPage.get(page.pageNumber) ?? []).map((table) =>
        remapOcrTableElementId(table, ocrElementIdRemaps)
      );
      if (!pageHadNativeText(nativeDocument, page.pageNumber)) {
        return ocrTables;
      }

      return mergePageTables(nativeTables, ocrTables);
    })
    .sort((left, right) => left.pageNumber - right.pageNumber);

  return normalizeParserDocument({
    ...nativeDocument,
    pages,
    elements,
    tables,
    diagnostics: nativeDocument.diagnostics,
    pageDiagnostics: nativeDocument.pageDiagnostics,
  }) as NormalizedLiteParseDocument;
}

export function targetPagesFromPageNumbers(pageNumbers: number[]): string {
  const sorted = [...new Set(pageNumbers.filter((pageNumber) => Number.isInteger(pageNumber)))]
    .filter((pageNumber) => pageNumber > 0)
    .sort((left, right) => left - right);
  const ranges: string[] = [];
  let start: number | null = null;
  let previous: number | null = null;

  for (const pageNumber of sorted) {
    if (start === null || previous === null) {
      start = pageNumber;
      previous = pageNumber;
      continue;
    }

    if (pageNumber === previous + 1) {
      previous = pageNumber;
      continue;
    }

    ranges.push(formatPageRange(start, previous));
    start = pageNumber;
    previous = pageNumber;
  }

  if (start !== null && previous !== null) {
    ranges.push(formatPageRange(start, previous));
  }

  return ranges.join(',');
}

export function computeLiteParseOcrWorkerCount(logicalCoreCount: number): number {
  const cores = Number.isFinite(logicalCoreCount) ? Math.floor(logicalCoreCount) : 1;
  return Math.max(1, Math.min(8, Math.floor(Math.max(1, cores) / 2)));
}

async function defaultLiteParseExecutor(input: LiteParseExecutorInput): Promise<unknown> {
  const module = await loadLiteParseModule();

  if (module?.LiteParse) {
    const parser = new module.LiteParse(input.options);
    return parser.parse(input.filePath);
  }

  return runLiteParseCli(input.filePath, input.options);
}

async function loadLiteParseModule(): Promise<{ LiteParse?: new (options: LiteParseOptions) => {
  parse(input: string): Promise<unknown>;
} } | null> {
  try {
    return (await import('@llamaindex/liteparse')) as {
      LiteParse?: new (options: LiteParseOptions) => { parse(input: string): Promise<unknown> };
    };
  } catch {
    try {
      const require = createRequire(import.meta.url);
      return require('@llamaindex/liteparse') as {
        LiteParse?: new (options: LiteParseOptions) => { parse(input: string): Promise<unknown> };
      };
    } catch {
      return null;
    }
  }
}

function runLiteParseCli(filePath: string, options: LiteParseOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'lit.cmd' : 'lit';
    const child = spawn(command, ['parse', filePath, ...liteParseCliArgs(options)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`LiteParse CLI failed: ${stderr || stdout || `exit code ${exitCode}`}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`LiteParse CLI returned invalid JSON: ${errorMessage(error)}`));
      }
    });
  });
}

function liteParseCliArgs(options: LiteParseOptions): string[] {
  const args = ['--format', 'json'];

  if (options.ocrEnabled === false) {
    args.push('--no-ocr');
  }
  if (options.ocrLanguage) {
    args.push('--ocr-language', options.ocrLanguage);
  }
  if (options.ocrServerUrl) {
    args.push('--ocr-server-url', options.ocrServerUrl);
  }
  if (options.maxPages !== undefined) {
    args.push('--max-pages', String(options.maxPages));
  }
  if (options.targetPages) {
    args.push('--target-pages', options.targetPages);
  }
  if (options.dpi !== undefined) {
    args.push('--dpi', String(options.dpi));
  }
  if (options.password) {
    args.push('--password', options.password);
  }
  if (options.preserveVerySmallText) {
    args.push('--preserve-small-text');
  }
  if (options.quiet) {
    args.push('--quiet');
  }
  if (options.numWorkers !== undefined) {
    args.push('--num-workers', String(options.numWorkers));
  }

  for (const [name, value] of Object.entries(options.ocrServerHeaders ?? {})) {
    args.push('--ocr-server-header', `${name}: ${value}`);
  }

  return args;
}

function normalizeLiteParsePage(
  value: unknown,
  index: number,
  extractionMode: ParserExtractionMode
): NormalizedParserPage {
  const record = asRecord(value);
  const pageNumber = asNumber(record.pageNum, asNumber(record.page, index + 1));
  const text = asString(record.text, '');
  const boundingBoxes = textItemsForPage(value, text)
    .map((item) => normalizeBbox(item))
    .filter((box): box is NonNullable<ReturnType<typeof normalizeBbox>> => box !== null);

  return {
    pageNumber,
    text,
    extractionMode,
    boundingBoxes,
  };
}

function textItemsForPage(page: unknown, fallbackText: string): LiteParseTextItem[] {
  const items = asArray(asRecord(page).textItems)
    .map(asTextItem)
    .filter((item): item is LiteParseTextItem => item !== null);

  if (items.length > 0 || fallbackText.trim().length === 0) {
    return items;
  }

  return [{ text: fallbackText }];
}

function asTextItem(value: unknown): LiteParseTextItem | null {
  const record = asRecord(value);
  const text = asString(record.text, '');
  if (text.trim().length === 0) {
    return null;
  }

  return {
    text,
    x: asOptionalNumber(record.x),
    y: asOptionalNumber(record.y),
    width: asOptionalNumber(record.width),
    height: asOptionalNumber(record.height),
    confidence: asOptionalNumber(record.confidence),
  };
}

function normalizeTextItemElement(
  item: LiteParseTextItem,
  pageNumber: number,
  itemIndex: number
): NormalizedParserElement {
  const sourceId = `page-${pageNumber}-item-${itemIndex + 1}`;
  const kind = classifyElementKind(item.text);

  return {
    elementId: `liteparse-${sourceId}`,
    kind,
    text: item.text,
    pageNumber,
    level: kind === 'heading' ? headingLevel(item.text) : null,
    confidence: item.confidence ?? 1,
    bbox: normalizeBbox(item),
    sourceIds: [sourceId],
  };
}

function normalizeBbox(item: LiteParseTextItem): NormalizedParserElement['bbox'] {
  if (
    item.x === undefined ||
    item.y === undefined ||
    item.width === undefined ||
    item.height === undefined
  ) {
    return null;
  }

  return { x: item.x, y: item.y, width: item.width, height: item.height };
}

function classifyElementKind(text: string): NormalizedParserElement['kind'] {
  if (isTableText(text)) {
    return 'table';
  }
  if (/^(?:Section|Subsection|Article|Sentence|Part|Chapter|Appendix|Note)\s+/i.test(text)) {
    return 'heading';
  }

  return 'text';
}

function isTableText(text: string): boolean {
  return /^Table\s+/i.test(text) || text.includes('|');
}

function headingLevel(text: string): number {
  if (/^(?:Part|Chapter)\s+/i.test(text)) {
    return 1;
  }

  return 2;
}

function tableFromElement(element: NormalizedParserElement): NormalizedParserTable {
  const columns = element.text.includes('|')
    ? element.text
        .split('|')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];

  return {
    elementId: element.elementId,
    caption: element.text,
    pageNumber: element.pageNumber,
    columns,
    rows: [],
    notes: [],
    confidence: element.confidence,
    sourceIds: element.sourceIds,
  };
}

function scoreNativePages(document: NormalizedLiteParseDocument): PageQualityScore[] {
  const codePatterns = new Map(
    document.pages.map((page) => [page.pageNumber, hasExpectedCodePattern(page.text)])
  );

  return document.pages.map((page, index) =>
    scorePageExtractionQuality({
      pageNumber: page.pageNumber,
      text: page.text,
      textItemCount: document.elements.filter((element) => element.pageNumber === page.pageNumber)
        .length,
      imageAreaRatio: estimateImageAreaRatio(page),
      tableLikeLineCount: countTableLikeLines(page.text),
      previousPageHadCodePattern:
        index > 0 ? codePatterns.get(document.pages[index - 1].pageNumber) : false,
      nextPageHasCodePattern:
        index < document.pages.length - 1
          ? codePatterns.get(document.pages[index + 1].pageNumber)
          : false,
    })
  );
}

function pageDiagnosticsFromScores(
  scores: PageQualityScore[],
  pages: NormalizedParserPage[]
): ParserPageDiagnostic[] {
  const pagesByNumber = new Map(pages.map((page) => [page.pageNumber, page]));

  return scores.map((score) => ({
    pageNumber: score.pageNumber,
    extractionMode: pagesByNumber.get(score.pageNumber)?.extractionMode ?? 'native',
    severity: score.suspicious ? 'warning' : 'info',
    message: score.suspicious
      ? 'LiteParse native extraction flagged for OCR'
      : 'LiteParse native extraction accepted',
    reasons: [...score.reasons, ...score.softReasons],
  }));
}

function markBudgetSkippedPageDiagnostics(
  pageDiagnostics: ParserPageDiagnostic[],
  budgetSkippedPageNumbers: Set<number>
): ParserPageDiagnostic[] {
  if (budgetSkippedPageNumbers.size === 0) {
    return pageDiagnostics;
  }

  return pageDiagnostics.map((diagnostic) =>
    budgetSkippedPageNumbers.has(diagnostic.pageNumber)
      ? {
          ...diagnostic,
          message: 'LiteParse OCR skipped for suspicious page due to OCR page budget',
          reasons: [...diagnostic.reasons, 'OCR page budget exhausted'],
        }
      : diagnostic
  );
}

function estimateImageAreaRatio(page: NormalizedParserPage): number {
  const charCount = page.text.replace(/\s/g, '').length;
  return charCount < 20 ? 1 : 0;
}

function countTableLikeLines(text: string): number {
  return text
    .split(/\r?\n/)
    .filter((line) => line.includes('|') || /\S+\s{2,}\S+\s{2,}\S+/.test(line)).length;
}

function mergedOcrPageNumbers(
  ocrDocument: NormalizedLiteParseDocument,
  selectedPageNumbers: number[]
): number[] {
  const selected = new Set(selectedPageNumbers);
  return ocrDocument.pages
    .filter((page) => selected.has(page.pageNumber))
    .map((page) => page.pageNumber);
}

function pageHadNativeText(document: NormalizedLiteParseDocument, pageNumber: number): boolean {
  return (document.pages.find((page) => page.pageNumber === pageNumber)?.text.trim().length ?? 0) > 0;
}

function mergePageText(nativeText: string, ocrText: string): string {
  const nativeTrimmed = nativeText.trim();
  const ocrTrimmed = ocrText.trim();

  if (nativeTrimmed.length === 0) {
    return ocrText;
  }
  if (ocrTrimmed.length === 0 || nativeTrimmed === ocrTrimmed) {
    return nativeText;
  }

  const nativeLineKeys = new Set(nativeText.split(/\r?\n/).map(normalizeTextForDedupe));
  const appendedOcrLines = ocrText
    .split(/\r?\n/)
    .filter((line) => {
      const lineKey = normalizeTextForDedupe(line);
      return lineKey.length > 0 && !nativeLineKeys.has(lineKey);
    });

  if (appendedOcrLines.length === 0) {
    return nativeText;
  }

  return `${nativeText.trimEnd()}\n${appendedOcrLines.join('\n').trimStart()}`;
}

function mergeBoundingBoxes(
  nativeBoxes: NormalizedParserPage['boundingBoxes'],
  ocrBoxes: NormalizedParserPage['boundingBoxes']
): NormalizedParserPage['boundingBoxes'] {
  const seen = new Set<string>();
  const merged: NormalizedParserPage['boundingBoxes'] = [];

  for (const box of [...nativeBoxes, ...ocrBoxes]) {
    const key = boundingBoxKey(box);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(box);
  }

  return merged;
}

function groupByPageNumber<T extends { pageNumber: number }>(items: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();

  for (const item of items) {
    const pageItems = grouped.get(item.pageNumber) ?? [];
    pageItems.push(item);
    grouped.set(item.pageNumber, pageItems);
  }

  return grouped;
}

function mergePageElements(
  nativeElements: NormalizedParserElement[],
  ocrElements: NormalizedParserElement[],
  ocrElementIdRemaps: Map<string, string>
): NormalizedParserElement[] {
  const merged: NormalizedParserElement[] = [];
  const usedElementIds = new Set<string>();
  const signatureToElementId = new Map<string, string>();

  for (const element of nativeElements) {
    merged.push(element);
    usedElementIds.add(element.elementId);
    signatureToElementId.set(elementSignature(element), element.elementId);
  }

  for (const element of ocrElements) {
    const signature = elementSignature(element);
    const existingElementId = signatureToElementId.get(signature);
    if (existingElementId) {
      ocrElementIdRemaps.set(
        elementIdentityKey(element.pageNumber, element.elementId),
        existingElementId
      );
      continue;
    }

    const mergedElement = usedElementIds.has(element.elementId)
      ? {
          ...element,
          elementId: uniqueElementId(`${element.elementId}-ocr`, usedElementIds),
        }
      : element;

    merged.push(mergedElement);
    usedElementIds.add(mergedElement.elementId);
    signatureToElementId.set(signature, mergedElement.elementId);
    ocrElementIdRemaps.set(
      elementIdentityKey(element.pageNumber, element.elementId),
      mergedElement.elementId
    );
  }

  return merged;
}

function mergePageTables(
  nativeTables: NormalizedParserTable[],
  ocrTables: NormalizedParserTable[]
): NormalizedParserTable[] {
  const merged: NormalizedParserTable[] = [];
  const usedElementIds = new Set<string>();
  const signatures = new Set<string>();

  for (const table of nativeTables) {
    merged.push(table);
    usedElementIds.add(table.elementId);
    signatures.add(tableSignature(table));
  }

  for (const table of ocrTables) {
    const signature = tableSignature(table);
    if (signatures.has(signature)) {
      continue;
    }

    const mergedTable = usedElementIds.has(table.elementId)
      ? {
          ...table,
          elementId: uniqueElementId(`${table.elementId}-ocr`, usedElementIds),
        }
      : table;

    merged.push(mergedTable);
    usedElementIds.add(mergedTable.elementId);
    signatures.add(signature);
  }

  return merged;
}

function remapOcrTableElementId(
  table: NormalizedParserTable,
  ocrElementIdRemaps: Map<string, string>
): NormalizedParserTable {
  const elementId = ocrElementIdRemaps.get(elementIdentityKey(table.pageNumber, table.elementId));

  return elementId && elementId !== table.elementId ? { ...table, elementId } : table;
}

function uniqueElementId(elementId: string, usedElementIds: Set<string>): string {
  if (!usedElementIds.has(elementId)) {
    return elementId;
  }

  let index = 2;
  let candidate = `${elementId}-${index}`;
  while (usedElementIds.has(candidate)) {
    index += 1;
    candidate = `${elementId}-${index}`;
  }

  return candidate;
}

function elementSignature(element: NormalizedParserElement): string {
  return [
    element.kind,
    element.pageNumber,
    element.text.trim(),
    element.level ?? '',
    element.bbox ? boundingBoxKey(element.bbox) : '',
  ].join('\u0000');
}

function tableSignature(table: NormalizedParserTable): string {
  return [
    table.pageNumber,
    table.caption.trim(),
    table.columns.join('\u0000'),
    table.rows.map((row) => row.join('\u0000')).join('\u0001'),
    table.notes.join('\u0000'),
  ].join('\u0002');
}

function boundingBoxKey(box: NormalizedParserElement['bbox']): string {
  if (!box) {
    return '';
  }

  return `${box.x}:${box.y}:${box.width}:${box.height}`;
}

function elementIdentityKey(pageNumber: number, elementId: string): string {
  return `${pageNumber}\u0000${elementId}`;
}

function normalizeTextForDedupe(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function comparePageElementOrder(
  left: NormalizedParserElement,
  right: NormalizedParserElement
): number {
  if (left.pageNumber !== right.pageNumber) {
    return left.pageNumber - right.pageNumber;
  }

  return left.elementId.localeCompare(right.elementId);
}

function formatPageRange(start: number, end: number): string {
  return start === end ? String(start) : `${start}-${end}`;
}

async function emitProgress(
  onProgress: ParseDocumentWithLiteParseInput['onProgress'],
  progress: ParseDocumentProgress
): Promise<void> {
  await onProgress?.(progress);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
