export type ParserName = 'docling' | 'liteparse' | 'fixture';
export type ParserExtractionMode = 'native' | 'ocr' | 'native_plus_ocr';
export type ParserElementKind = 'heading' | 'text' | 'table' | 'figure' | 'list' | 'unknown';
export type ParserDiagnosticSeverity = 'info' | 'warning' | 'error';
export type ParserProgressPhase = 'queued' | 'parsing' | 'ocr' | 'canonicalizing' | 'embedding';

export interface ParserBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedParserPage {
  pageNumber: number;
  text: string;
  extractionMode: ParserExtractionMode;
  boundingBoxes: ParserBoundingBox[];
}

export interface NormalizedParserElement {
  elementId: string;
  kind: ParserElementKind;
  text: string;
  pageNumber: number;
  level: number | null;
  confidence: number;
  bbox: ParserBoundingBox | null;
  sourceIds: string[];
}

export interface NormalizedParserTable {
  elementId: string;
  caption: string;
  pageNumber: number;
  columns: string[];
  rows: string[][];
  notes: string[];
  confidence: number;
  sourceIds: string[];
}

export interface ParserPageDiagnostic {
  pageNumber: number;
  extractionMode: ParserExtractionMode;
  severity: ParserDiagnosticSeverity;
  message: string;
  reasons: string[];
}

export interface NormalizedParserDocument {
  parserName: ParserName;
  parserVersion: string;
  pages: NormalizedParserPage[];
  elements: NormalizedParserElement[];
  tables: NormalizedParserTable[];
  diagnostics: string[];
  pageDiagnostics: ParserPageDiagnostic[];
}

export interface ParseDocumentProgress {
  phase: ParserProgressPhase;
  message: string;
  currentPage: number | null;
  totalPages: number | null;
  ocrPageCount: number;
}

export interface ParseDocumentInput {
  filePath: string;
  onProgress?: (progress: ParseDocumentProgress) => void | Promise<void>;
}

export type ParseDocument = (input: ParseDocumentInput) => Promise<NormalizedParserDocument>;

const supportedParserNames = new Set<ParserName>(['docling', 'liteparse', 'fixture']);
const supportedElementKinds = new Set<ParserElementKind>([
  'heading',
  'text',
  'table',
  'figure',
  'list',
  'unknown',
]);
const supportedExtractionModes = new Set<ParserExtractionMode>([
  'native',
  'ocr',
  'native_plus_ocr',
]);

export function normalizeParserDocument(value: unknown): NormalizedParserDocument {
  const record = requireRecord(value, 'root');
  const parserName = requireString(record.parserName, 'parserName');

  if (!supportedParserNames.has(parserName as ParserName)) {
    throwInvalid('parserName must be docling, liteparse, or fixture');
  }

  return {
    parserName: parserName as ParserName,
    parserVersion: requireString(record.parserVersion, 'parserVersion'),
    pages: requireArray(record.pages, 'pages').map(normalizePage),
    elements: requireArray(record.elements, 'elements').map(normalizeElement),
    tables: requireArray(record.tables, 'tables').map(normalizeTable),
    diagnostics: requireArray(record.diagnostics, 'diagnostics').map((item, index) =>
      requireString(item, `diagnostics[${index}]`)
    ),
    pageDiagnostics: requireArray(record.pageDiagnostics, 'pageDiagnostics').map(
      normalizePageDiagnostic
    ),
  };
}

function normalizePage(value: unknown, index: number): NormalizedParserPage {
  const prefix = `pages[${index}]`;
  const record = requireRecord(value, prefix);

  return {
    pageNumber: requireFiniteNumber(record.pageNumber, `${prefix}.pageNumber`),
    text: requireString(record.text, `${prefix}.text`),
    extractionMode: requireExtractionMode(record.extractionMode, `${prefix}.extractionMode`),
    boundingBoxes: optionalArray(record.boundingBoxes, `${prefix}.boundingBoxes`).map((box, boxIndex) =>
      normalizeBox(box, `${prefix}.boundingBoxes[${boxIndex}]`)
    ),
  };
}

function normalizeElement(value: unknown, index: number): NormalizedParserElement {
  const prefix = `elements[${index}]`;
  const record = requireRecord(value, prefix);
  const kind = requireString(record.kind, `${prefix}.kind`);

  if (!supportedElementKinds.has(kind as ParserElementKind)) {
    throwInvalid(`${prefix}.kind must be a supported parser element kind`);
  }

  return {
    elementId: requireString(record.elementId, `${prefix}.elementId`),
    kind: kind as ParserElementKind,
    text: requireString(record.text, `${prefix}.text`),
    pageNumber: requireFiniteNumber(record.pageNumber, `${prefix}.pageNumber`),
    level: record.level === null ? null : requireFiniteNumber(record.level, `${prefix}.level`),
    confidence: requireFiniteNumber(record.confidence, `${prefix}.confidence`),
    bbox: record.bbox === null ? null : normalizeBox(record.bbox, `${prefix}.bbox`),
    sourceIds: optionalArray(record.sourceIds, `${prefix}.sourceIds`).map((item, sourceIndex) =>
      requireString(item, `${prefix}.sourceIds[${sourceIndex}]`)
    ),
  };
}

function normalizeTable(value: unknown, index: number): NormalizedParserTable {
  const prefix = `tables[${index}]`;
  const record = requireRecord(value, prefix);

  return {
    elementId: requireString(record.elementId, `${prefix}.elementId`),
    caption: requireString(record.caption, `${prefix}.caption`),
    pageNumber: requireFiniteNumber(record.pageNumber, `${prefix}.pageNumber`),
    columns: requireStringArray(record.columns, `${prefix}.columns`),
    rows: requireArray(record.rows, `${prefix}.rows`).map((row, rowIndex) =>
      requireStringArray(row, `${prefix}.rows[${rowIndex}]`)
    ),
    notes: requireStringArray(record.notes, `${prefix}.notes`),
    confidence: requireFiniteNumber(record.confidence, `${prefix}.confidence`),
    sourceIds: optionalArray(record.sourceIds, `${prefix}.sourceIds`).map((item, sourceIndex) =>
      requireString(item, `${prefix}.sourceIds[${sourceIndex}]`)
    ),
  };
}

function normalizePageDiagnostic(value: unknown, index: number): ParserPageDiagnostic {
  const prefix = `pageDiagnostics[${index}]`;
  const record = requireRecord(value, prefix);
  const severity = requireString(record.severity, `${prefix}.severity`);

  if (severity !== 'info' && severity !== 'warning' && severity !== 'error') {
    throwInvalid(`${prefix}.severity must be info, warning, or error`);
  }

  return {
    pageNumber: requireFiniteNumber(record.pageNumber, `${prefix}.pageNumber`),
    extractionMode: requireExtractionMode(record.extractionMode, `${prefix}.extractionMode`),
    severity,
    message: requireString(record.message, `${prefix}.message`),
    reasons: requireStringArray(record.reasons, `${prefix}.reasons`),
  };
}

function normalizeBox(value: unknown, prefix: string): ParserBoundingBox {
  const record = requireRecord(value, prefix);

  return {
    x: requireFiniteNumber(record.x, `${prefix}.x`),
    y: requireFiniteNumber(record.y, `${prefix}.y`),
    width: requireFiniteNumber(record.width, `${prefix}.width`),
    height: requireFiniteNumber(record.height, `${prefix}.height`),
  };
}

function requireExtractionMode(value: unknown, prefix: string): ParserExtractionMode {
  const mode = requireString(value, prefix);

  if (!supportedExtractionModes.has(mode as ParserExtractionMode)) {
    throwInvalid(`${prefix} must be native, ocr, or native_plus_ocr`);
  }

  return mode as ParserExtractionMode;
}

function requireStringArray(value: unknown, prefix: string): string[] {
  return requireArray(value, prefix).map((item, index) => requireString(item, `${prefix}[${index}]`));
}

function optionalArray(value: unknown, prefix: string): unknown[] {
  if (value === undefined) {
    return [];
  }

  return requireArray(value, prefix);
}

function requireArray(value: unknown, prefix: string): unknown[] {
  if (!Array.isArray(value)) {
    throwInvalid(`${prefix} must be an array`);
  }

  return value;
}

function requireRecord(value: unknown, prefix: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throwInvalid(`${prefix} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, prefix: string): string {
  if (typeof value !== 'string') {
    throwInvalid(`${prefix} must be a string`);
  }

  return value;
}

function requireFiniteNumber(value: unknown, prefix: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throwInvalid(`${prefix} must be finite`);
  }

  return value;
}

function throwInvalid(message: string): never {
  throw new Error(`Parser returned invalid result: ${message}`);
}
