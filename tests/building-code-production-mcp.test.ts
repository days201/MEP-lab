import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleBuildingCodeTool, listBuildingCodeTools } from '../src/main/mcp/building-code-server';
import { saveBuildingCodeIndex, type BuildingCodeIndex } from '../src/main/mcp/building-code/index-store';

const roots: string[] = [];
let originalBuildingCodeIndexDir: string | undefined;
let originalBuildingCodeEmbeddingApiKey: string | undefined;
let originalOpenAiApiKey: string | undefined;

function index(): BuildingCodeIndex {
  return {
    version: 1,
    sources: [
      {
        sourceId: 'source-1',
        documentId: 'doc-1',
        codeFamily: 'NBC',
        edition: '2025',
        jurisdictionScope: 'Canada',
        sourceTitle: 'NBC 2025',
        sourceUrl: 'kb://building-code/doc-1/source.pdf',
        localSourcePath: '/tmp/source.pdf',
        sourceChecksum: 'sha256:abc',
      },
    ],
    pages: [],
    nodes: [
      {
        nodeId: 'node-1',
        sourceId: 'source-1',
        documentId: 'doc-1',
        nodeType: 'section',
        logicalRef: 'Section 9.10.3.1',
        title: 'Fire separations',
        text: 'Fire separations shall be continuous.',
        pageRange: '4',
        headingPath: ['Section 9.10.3.1 Fire separations'],
        parentNodeId: null,
        childNodeIds: [],
        extractionConfidence: 1,
        parser: {
          name: 'legacy',
          version: '2.0.0',
          sourceElementIds: ['h1'],
          pageRange: '4',
          boundingBoxes: [],
        },
      },
    ],
    chunks: [],
    vectors: [],
    tables: [],
    crossReferences: [],
    diagnostics: [],
    semanticSearchAvailable: false,
  };
}

describe('production Building_Code MCP behavior', () => {
  beforeEach(() => {
    originalBuildingCodeIndexDir = process.env.BUILDING_CODE_INDEX_DIR;
    originalBuildingCodeEmbeddingApiKey = process.env.BUILDING_CODE_EMBEDDING_API_KEY;
    originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    restoreEnv('BUILDING_CODE_INDEX_DIR', originalBuildingCodeIndexDir);
    restoreEnv('BUILDING_CODE_EMBEDDING_API_KEY', originalBuildingCodeEmbeddingApiKey);
    restoreEnv('OPENAI_API_KEY', originalOpenAiApiKey);
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not expose fixture input schema switches', () => {
    const schemas = JSON.stringify(listBuildingCodeTools());
    expect(schemas).not.toContain('fixture');
  });

  it('returns an empty-knowledge-base error when no active index is configured', async () => {
    await expect(handleBuildingCodeTool('read_section', { ref: 'Section 9.10.3.1' })).rejects.toThrow(
      'Building_Code knowledge base is empty'
    );
  });

  it('loads exact reads from the persisted active index only', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-mcp-'));
    roots.push(root);
    await saveBuildingCodeIndex(root, index());
    process.env.BUILDING_CODE_INDEX_DIR = root;

    const result = await handleBuildingCodeTool('read_section', { ref: 'Section 9.10.3.1' });

    expect(result.results[0]?.citation).toMatchObject({
      sourceUrl: 'kb://building-code/doc-1/source.pdf',
      displayCitation: 'NBC 2025, Section 9.10.3.1',
    });
  });

  it('reports semantic search unavailable when vectors are absent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-mcp-'));
    roots.push(root);
    await saveBuildingCodeIndex(root, index());
    process.env.BUILDING_CODE_INDEX_DIR = root;
    delete process.env.BUILDING_CODE_EMBEDDING_API_KEY;
    delete process.env.OPENAI_API_KEY;

    await expect(handleBuildingCodeTool('search', { query: 'fire separation' })).rejects.toThrow(
      'Building_Code semantic search is unavailable'
    );
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
