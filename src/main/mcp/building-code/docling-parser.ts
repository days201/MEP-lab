import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface NormalizedDoclingPage {
  pageNumber: number;
  text: string;
}

export interface NormalizedDoclingElement {
  elementId: string;
  kind: 'heading' | 'text' | 'table' | 'figure' | 'list' | 'unknown';
  text: string;
  pageNumber: number;
  level: number | null;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number } | null;
}

export interface NormalizedDoclingTable {
  elementId: string;
  caption: string;
  pageNumber: number;
  columns: string[];
  rows: string[][];
  notes: string[];
  confidence: number;
}

export interface NormalizedDoclingResult {
  parserName: 'docling';
  parserVersion: string;
  pages: NormalizedDoclingPage[];
  elements: NormalizedDoclingElement[];
  tables: NormalizedDoclingTable[];
  diagnostics: string[];
}

export interface DoclingProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type DoclingProcessRunner = (
  command: string,
  args: string[]
) => Promise<DoclingProcessResult>;

export interface ParseDocumentWithDoclingInput {
  documentPath: string;
  pythonExecutable?: string;
  bridgePath?: string;
  runProcess?: DoclingProcessRunner;
}

export class DoclingParserUnavailableError extends Error {
  constructor(
    message = 'Docling parser is unavailable. Install the local Docling Python package and retry.',
    public readonly details = ''
  ) {
    super(message);
    this.name = 'DoclingParserUnavailableError';
  }
}

const bridgePath = fileURLToPath(new URL('./docling_bridge.py', import.meta.url));
const supportedKinds = new Set<NormalizedDoclingElement['kind']>([
  'heading',
  'text',
  'table',
  'figure',
  'list',
  'unknown',
]);

export async function parseDocumentWithDocling(
  input: ParseDocumentWithDoclingInput
): Promise<NormalizedDoclingResult> {
  const command = input.pythonExecutable ?? 'python';
  const args = [input.bridgePath ?? bridgePath, input.documentPath];
  const result = await (input.runProcess ?? runProcess)(command, args);

  if (result.exitCode !== 0) {
    throwParserProcessError(result);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Docling parser returned invalid JSON: ${message}`);
  }

  return normalizeDoclingResult(parsed);
}

function runProcess(command: string, args: string[]): Promise<DoclingProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
    child.on('error', (error) => {
      resolve({ exitCode: 1, stdout, stderr: stderr || error.message });
    });
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function throwParserProcessError(result: DoclingProcessResult): never {
  const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();

  if (isMissingDoclingImport(output)) {
    throw new DoclingParserUnavailableError(
      'Docling parser is unavailable. Install the local Docling Python package and retry.',
      output
    );
  }

  throw new Error(`Docling parser failed: ${output || `exit code ${result.exitCode}`}`);
}

function isMissingDoclingImport(output: string): boolean {
  return (
    /ModuleNotFoundError:\s+No module named ['"]?docling['"]?/i.test(output) ||
    /ImportError:.*docling/i.test(output)
  );
}

function normalizeDoclingResult(value: unknown): NormalizedDoclingResult {
  const record = asRecord(value);

  return {
    parserName: 'docling',
    parserVersion: asString(record.parserVersion, 'unknown'),
    pages: asArray(record.pages).map(normalizePage),
    elements: asArray(record.elements).map(normalizeElement),
    tables: asArray(record.tables).map(normalizeTable),
    diagnostics: asArray(record.diagnostics).map((diagnostic) => asString(diagnostic, '')),
  };
}

function normalizePage(value: unknown, index: number): NormalizedDoclingPage {
  const record = asRecord(value);

  return {
    pageNumber: asNumber(record.pageNumber, index + 1),
    text: asString(record.text, ''),
  };
}

function normalizeElement(value: unknown, index: number): NormalizedDoclingElement {
  const record = asRecord(value);
  const kind = asString(record.kind, 'unknown');

  return {
    elementId: asString(record.elementId, `element-${index + 1}`),
    kind: supportedKinds.has(kind as NormalizedDoclingElement['kind'])
      ? (kind as NormalizedDoclingElement['kind'])
      : 'unknown',
    text: asString(record.text, ''),
    pageNumber: asNumber(record.pageNumber, 1),
    level: asNullableNumber(record.level),
    confidence: asNumber(record.confidence, 1),
    bbox: normalizeBbox(record.bbox),
  };
}

function normalizeTable(value: unknown, index: number): NormalizedDoclingTable {
  const record = asRecord(value);

  return {
    elementId: asString(record.elementId, `table-${index + 1}`),
    caption: asString(record.caption, ''),
    pageNumber: asNumber(record.pageNumber, 1),
    columns: asArray(record.columns).map((column) => asString(column, '')),
    rows: asArray(record.rows).map((row) =>
      asArray(row).map((cell) => asString(cell, ''))
    ),
    notes: asArray(record.notes).map((note) => asString(note, '')),
    confidence: asNumber(record.confidence, 1),
  };
}

function normalizeBbox(value: unknown): NormalizedDoclingElement['bbox'] {
  if (value === null || value === undefined) {
    return null;
  }

  const record = asRecord(value);
  const x = asNumber(record.x, Number.NaN);
  const y = asNumber(record.y, Number.NaN);
  const width = asNumber(record.width, Number.NaN);
  const height = asNumber(record.height, Number.NaN);

  if ([x, y, width, height].some((number) => Number.isNaN(number))) {
    return null;
  }

  return { x, y, width, height };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
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

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
