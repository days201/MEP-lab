import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface DoclingProcessOptions {
  timeoutMs: number;
}

export type DoclingProcessResult = ProcessResult;

export type DoclingProcessRunner = (
  command: string,
  args: string[],
  options?: DoclingProcessOptions
) => Promise<ProcessResult>;

export interface ParseDocumentWithDoclingInput {
  filePath: string;
  pythonPath: string;
  bridgePath?: string;
  timeoutMs?: number;
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

const DEFAULT_DOCLING_TIMEOUT_MS = 5 * 60 * 1000;
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
  const command = input.pythonPath;
  const args = [input.bridgePath ?? resolveDefaultBridgePath(), input.filePath];
  const result = await (input.runProcess ?? runProcess)(command, args, {
    timeoutMs: input.timeoutMs ?? DEFAULT_DOCLING_TIMEOUT_MS,
  });

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

function resolveDefaultBridgePath(): string {
  const candidates = [
    path.join(__dirname, 'docling_bridge.py'),
    path.join(__dirname, 'building-code', 'docling_bridge.py'),
    path.resolve(process.cwd(), 'src/main/mcp/building-code/docling_bridge.py'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function runProcess(
  command: string,
  args: string[],
  options: DoclingProcessOptions = { timeoutMs: DEFAULT_DOCLING_TIMEOUT_MS }
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      finish({
        exitCode: 1,
        stdout,
        stderr: `Docling parser timed out after ${options.timeoutMs}ms`,
      });
      child.kill();
    }, options.timeoutMs);

    const finish = (result: ProcessResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      finish({ exitCode: 1, stdout, stderr: stderr || error.message });
    });
    child.on('close', (exitCode) => {
      finish({ exitCode, stdout, stderr });
    });
  });
}

function throwParserProcessError(result: ProcessResult): never {
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
    /No module named\s+['"]?docling['"]?/i.test(output) ||
    /ModuleNotFoundError:\s+No module named ['"]?docling['"]?/i.test(output) ||
    /ImportError:.*docling/i.test(output) ||
    /ImportError:.*DocumentConverter.*docling/i.test(output)
  );
}

function normalizeDoclingResult(value: unknown): NormalizedDoclingResult {
  validateDoclingResult(value);
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

function validateDoclingResult(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throwInvalidResult('root must be an object');
  }

  const record = value as Record<string, unknown>;
  if (record.parserName !== 'docling') {
    throwInvalidResult('parserName must be docling');
  }
  if (typeof record.parserVersion !== 'string') {
    throwInvalidResult('parserVersion must be a string');
  }

  for (const key of ['pages', 'elements', 'tables', 'diagnostics']) {
    if (!Array.isArray(record[key])) {
      throwInvalidResult(`${key} must be an array`);
    }
  }
}

function throwInvalidResult(message: string): never {
  throw new Error(`Docling parser returned invalid result: ${message}`);
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
