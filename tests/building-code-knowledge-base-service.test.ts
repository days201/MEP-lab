import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeBaseService } from '../src/main/mcp/building-code/knowledge-base-service';
import type { NormalizedDoclingResult } from '../src/main/mcp/building-code/docling-parser';

const roots: string[] = [];

function parsed(): NormalizedDoclingResult {
  return {
    parserName: 'docling',
    parserVersion: '2.0.0',
    pages: [{ pageNumber: 1, text: 'Section 9.10.3.1 Fire separations\nBody text.' }],
    elements: [
      {
        elementId: 'h1',
        kind: 'heading',
        text: 'Section 9.10.3.1 Fire separations',
        pageNumber: 1,
        level: 2,
        confidence: 0.99,
        bbox: null,
      },
      {
        elementId: 'p1',
        kind: 'text',
        text: 'Body text.',
        pageNumber: 1,
        level: null,
        confidence: 0.99,
        bbox: null,
      },
    ],
    tables: [],
    diagnostics: [],
  };
}

describe('KnowledgeBaseService', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uploads, parses, embeds, registers, and writes an active index', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => parsed(),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    const overview = await service.uploadDocuments([source]);

    expect(overview.documents[0]).toMatchObject({ status: 'ready', documentId: 'doc-1' });
    expect(overview.summary.nodeCount).toBe(1);
    expect(overview.summary.semanticSearchAvailable).toBe(true);
    expect(fs.existsSync(path.join(userData, 'knowledge-base', 'building-code', 'index', 'index.json'))).toBe(true);
  });

  it('keeps the prior active index when parsing a new document fails', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const good = path.join(userData, 'good.md');
    const bad = path.join(userData, 'bad.md');
    fs.writeFileSync(good, 'Section 9.10.3.1 Fire separations\nBody text.');
    fs.writeFileSync(bad, 'No canonical headings here.');
    let shouldFail = false;
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => (shouldFail ? 'doc-bad' : 'doc-good'),
      parseDocument: async () => {
        if (shouldFail) throw new Error('parser exploded');
        return parsed();
      },
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      }),
    });

    await service.uploadDocuments([good]);
    const before = await service.getOverview();
    shouldFail = true;
    const after = await service.uploadDocuments([bad]);

    expect(after.documents.find((document) => document.documentId === 'doc-bad')).toMatchObject({
      status: 'failed',
      failureMessage: 'parser exploded',
    });
    expect(after.summary.nodeCount).toBe(before.summary.nodeCount);
  });

  it('marks embedding failures while preserving exact lookup records', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-service-'));
    roots.push(userData);
    const source = path.join(userData, 'input.md');
    fs.writeFileSync(source, 'Section 9.10.3.1 Fire separations\nBody text.');
    const service = new KnowledgeBaseService({
      userDataPath: userData,
      now: () => '2026-06-19T12:00:00.000Z',
      randomId: () => 'doc-1',
      parseDocument: async () => parsed(),
      embeddingClientFactory: () => ({
        model: 'text-embedding-3-small',
        embed: async () => {
          throw new Error('embedding endpoint down');
        },
      }),
    });

    const overview = await service.uploadDocuments([source]);

    expect(overview.documents[0].status).toBe('ready_with_warnings');
    expect(overview.summary.nodeCount).toBe(1);
    expect(overview.summary.semanticSearchAvailable).toBe(false);
    expect(overview.diagnostics.map((item) => item.message).join('\n')).toContain('embedding endpoint down');
  });
});
