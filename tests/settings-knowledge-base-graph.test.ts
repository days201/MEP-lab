import { describe, expect, it } from 'vitest';
import { buildKnowledgeBaseGraphViewModel } from '../src/renderer/components/settings/knowledge-base-graph';
import type { KnowledgeBaseGraphSummary } from '../src/shared/ipc-types';

describe('knowledge base graph view model', () => {
  it('rewrites hidden duplicate node edges only within the same document', () => {
    const graph: KnowledgeBaseGraphSummary = {
      sectionCount: 2,
      tableCount: 0,
      referenceEdgeCount: 1,
      unresolvedReferenceCount: 1,
      nodes: [
        {
          nodeId: 'node-1',
          documentId: 'doc-a',
          logicalRef: 'Section 9.10.3.1',
          title: 'Fire separations',
          nodeType: 'section',
        },
        {
          nodeId: 'node-2',
          documentId: 'doc-b',
          logicalRef: 'Section 9.10.3.1',
          title: 'Fire separations in another document',
          nodeType: 'section',
        },
        {
          nodeId: 'node-3',
          documentId: 'doc-a',
          logicalRef: 'Section 9.10.3.1',
          title: 'Fire separations duplicate',
          nodeType: 'section',
        },
      ],
      edges: [
        {
          fromNodeId: 'node-3',
          targetNodeId: null,
          targetLogicalRef: 'Table 10.1.2.3',
          rawText: 'Table 10.1.2.3',
          status: 'unresolved',
        },
      ],
    };

    const viewModel = buildKnowledgeBaseGraphViewModel(graph);

    expect(viewModel.nodes).toHaveLength(2);
    expect(viewModel.resolveNodeId('node-1')).toBe('node-1');
    expect(viewModel.resolveNodeId('node-2')).toBe('node-2');
    expect(viewModel.resolveNodeId('node-3')).toBe('node-1');
    expect(viewModel.edges).toEqual([
      expect.objectContaining({
        fromNodeId: 'node-1',
        targetNodeId: null,
        targetLogicalRef: 'Table 10.1.2.3',
        status: 'unresolved',
      }),
    ]);
  });
});
