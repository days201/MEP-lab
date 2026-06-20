import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFromBuildingCodePreset, handleBuildingCodeTool, listBuildingCodeTools } from '../src/main/mcp/building-code-server';
import { saveBuildingCodeIndex, type BuildingCodeIndex } from '../src/main/mcp/building-code/index-store';

const roots: string[] = [];

function persistedIndex(): BuildingCodeIndex {
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
          name: 'docling',
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

describe('building-code MCP server surface', () => {
  afterEach(() => {
    delete process.env.BUILDING_CODE_INDEX_DIR;
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes exactly the low-level building-code tools', () => {
    expect(listBuildingCodeTools().map((tool) => tool.name)).toEqual([
      'search',
      'read_section',
      'resolve_cross_refs',
      'lookup_table',
    ]);
    expect(JSON.stringify(listBuildingCodeTools())).not.toContain('fixture');
  });

  it('handles exact section reads from a persisted active index', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-mcp-'));
    roots.push(root);
    await saveBuildingCodeIndex(root, persistedIndex());
    process.env.BUILDING_CODE_INDEX_DIR = root;

    const sectionResult = await handleBuildingCodeTool('read_section', {
      ref: 'Section 9.10.3.1',
    });

    expect(sectionResult.content).toEqual(expect.any(Array));
    expect(JSON.stringify(sectionResult)).toContain('kb://building-code/doc-1/source.pdf');
    expect(JSON.stringify(sectionResult)).toContain('"displayCitation"');
  });

  it('defines a Building_Code preset that resolves the bundled server path', () => {
    const preset = createFromBuildingCodePreset();

    expect(preset.name).toBe('Building_Code');
    expect(preset.args?.[0]).toMatch(/building-code-server\.(js|ts)$/);
    expect(preset.args?.[0]).not.toBe('{BUILDING_CODE_SERVER_PATH}');
  });
});
