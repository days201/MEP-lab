import type { KnowledgeBaseGraphSummary } from '../../../shared/ipc-types';

export interface KnowledgeBaseGraphViewModel {
  nodes: KnowledgeBaseGraphSummary['nodes'];
  edges: KnowledgeBaseGraphSummary['edges'];
  resolveNodeId(nodeId: string): string;
}

export function buildKnowledgeBaseGraphViewModel(
  graph: KnowledgeBaseGraphSummary | null | undefined
): KnowledgeBaseGraphViewModel {
  const nodes = graph?.nodes ?? [];
  const canonicalNodes: KnowledgeBaseGraphSummary['nodes'] = [];
  const canonicalNodeIdsByOriginalId = new Map<string, string>();
  const canonicalNodeIdsByKey = new Map<string, string>();

  for (const node of nodes) {
    const key = `${node.documentId}:${node.nodeType}:${node.logicalRef}`;
    const canonicalNodeId = canonicalNodeIdsByKey.get(key);
    if (canonicalNodeId) {
      canonicalNodeIdsByOriginalId.set(node.nodeId, canonicalNodeId);
      continue;
    }

    canonicalNodeIdsByKey.set(key, node.nodeId);
    canonicalNodeIdsByOriginalId.set(node.nodeId, node.nodeId);
    canonicalNodes.push(node);
  }

  const canonicalizeNodeId = (nodeId: string | null): string | null => {
    if (!nodeId) {
      return null;
    }
    return canonicalNodeIdsByOriginalId.get(nodeId) ?? nodeId;
  };

  return {
    nodes: canonicalNodes,
    edges: (graph?.edges ?? []).map((edge) => ({
      ...edge,
      fromNodeId: canonicalizeNodeId(edge.fromNodeId) ?? edge.fromNodeId,
      targetNodeId: canonicalizeNodeId(edge.targetNodeId),
    })),
    resolveNodeId(nodeId: string): string {
      return canonicalNodeIdsByOriginalId.get(nodeId) ?? nodeId;
    },
  };
}
