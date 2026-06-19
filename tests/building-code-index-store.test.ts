import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBuildingCodeIndex, saveBuildingCodeIndex } from '../src/main/mcp/building-code/index-store';
import type { BuildingCodeIndex } from '../src/main/mcp/building-code/index-store';

const tempRoots: string[] = [];

function minimalIndex(): BuildingCodeIndex {
  return {
    version: 1,
    sources: [],
    pages: [],
    nodes: [],
    chunks: [],
    vectors: [
      {
        chunkId: 'chunk-1',
        embeddingModel: 'text-embedding-3-small',
        embedding: [1, 0],
        embeddingTextHash: 'sha256:abc',
      },
    ],
    tables: [],
    crossReferences: [],
    diagnostics: ['fixture diagnostic'],
  };
}

describe('building-code index store', () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('persists canonical index data and vectors into versioned JSON files', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);
    const index = minimalIndex();

    await saveBuildingCodeIndex(tempRoot, index);
    const loaded = await loadBuildingCodeIndex(tempRoot);

    expect(fs.existsSync(path.join(tempRoot, 'index.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, 'vectors.json'))).toBe(true);
    expect(loaded).toEqual(index);
  });

  it('rejects unsupported index schema versions', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);

    fs.writeFileSync(
      path.join(tempRoot, 'index.json'),
      JSON.stringify({
        ...minimalIndex(),
        version: 999,
        vectors: undefined,
      })
    );
    fs.writeFileSync(path.join(tempRoot, 'vectors.json'), JSON.stringify({ version: 1, vectors: [] }));

    await expect(loadBuildingCodeIndex(tempRoot)).rejects.toThrow('Unsupported building-code index');
  });

  it('normalizes provenance defaults when loading legacy-shaped v1 index records', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'building-code-index-'));
    tempRoots.push(tempRoot);

    fs.writeFileSync(
      path.join(tempRoot, 'index.json'),
      JSON.stringify({
        ...minimalIndex(),
        sources: [
          {
            sourceId: 'legacy-source-1',
            codeFamily: 'NBC',
            edition: '2025',
            jurisdictionScope: 'Canada',
            sourceTitle: 'Legacy NBC fixture',
            sourceUrl: 'fixture://nbc-2025-refrigerant-excerpt.md',
            sourceChecksum: 'sha256:legacy',
          },
        ],
        nodes: [
          {
            nodeId: 'legacy-node-1',
            sourceId: 'legacy-source-1',
            nodeType: 'section',
            logicalRef: 'Section 1.1',
            title: 'Legacy section',
            text: 'Legacy section text.',
            pageRange: '4-5',
            headingPath: ['NBC 2025', 'Section 1.1 Legacy section'],
            parentNodeId: null,
            childNodeIds: [],
          },
        ],
        vectors: undefined,
      })
    );
    fs.writeFileSync(path.join(tempRoot, 'vectors.json'), JSON.stringify({ version: 1, vectors: [] }));

    const loaded = await loadBuildingCodeIndex(tempRoot);

    expect(loaded.sources[0]).toMatchObject({
      sourceId: 'legacy-source-1',
      documentId: 'legacy-source-1',
      localSourcePath: '',
    });
    expect(loaded.nodes[0]).toMatchObject({
      nodeId: 'legacy-node-1',
      documentId: 'legacy-source-1',
      extractionConfidence: 1,
      parser: {
        name: 'fixture',
        version: 'test-fixture',
        sourceElementIds: [],
        pageRange: '4-5',
        boundingBoxes: [],
      },
    });
  });
});
