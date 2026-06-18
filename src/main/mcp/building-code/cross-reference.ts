import type { CodeCrossReferenceRecord, CodeNodeRecord } from './types';

const referencePattern =
  /\b(Section\s+\d+(?:\.\d+)*|Table\s+\d+(?:\.\d+)*|Figure\s+\d+(?:\.\d+)*|Appendix\s+[A-Z])\b/gi;

export function resolveCrossReferences(nodes: CodeNodeRecord[]): CodeCrossReferenceRecord[] {
  const nodesByLogicalRef = new Map(nodes.map((node) => [node.logicalRef, node]));
  const references: CodeCrossReferenceRecord[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    for (const match of node.text.matchAll(referencePattern)) {
      const rawText = match[1];
      const targetLogicalRef = normalizeLogicalRef(rawText);
      if (targetLogicalRef === node.logicalRef) {
        continue;
      }

      const key = `${node.nodeId}:${targetLogicalRef}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const targetNode = nodesByLogicalRef.get(targetLogicalRef) ?? null;
      references.push({
        fromNodeId: node.nodeId,
        rawText,
        targetLogicalRef,
        targetNodeId: targetNode?.nodeId ?? null,
        status: targetNode ? 'resolved' : 'unresolved',
      });
    }
  }

  return references;
}

function normalizeLogicalRef(rawLogicalRef: string): string {
  return rawLogicalRef
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^section\b/i, 'Section')
    .replace(/^table\b/i, 'Table')
    .replace(/^figure\b/i, 'Figure')
    .replace(/^appendix\b/i, 'Appendix');
}
