import type { CodeCrossReferenceRecord, CodeNodeRecord } from './types';

const referencePattern =
  /\b(Section\s+\d+(?:\.\d+)*(?:\.(?=\.))?|Article\s+\d+(?:\.\d+)*(?:\.(?=\.))?|Sentence\s+\d+(?:\.\d+)*(?:\.\(\d+\))?|Subsection\s+\d+(?:\.\d+)*(?:\.(?=\.))?|Part\s+\d+|Chapter\s+\d+|Table\s+\d+(?:\.\d+)*(?:\.(?=\.))?|Figure\s+\d+(?:\.\d+)*(?:\.(?=\.))?|Appendix\s+[A-Z]|Note\s+[A-Z]-\d+(?:\.\d+)*(?:\.(?=\.))?)(?=\W|$)/gi;

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
  const normalized = rawLogicalRef.trim().replace(/\s+/g, ' ');
  const match = normalized.match(/^([A-Za-z]+)\s+(.+)$/);
  if (!match) {
    return normalized.replace(/\.$/, '');
  }
  const prefix = canonicalPrefix(match[1]);
  return `${prefix} ${match[2].replace(/\.$/, '')}`;
}

function canonicalPrefix(prefix: string): string {
  const lower = prefix.toLowerCase();
  const known: Record<string, string> = {
    section: 'Section',
    article: 'Article',
    sentence: 'Sentence',
    subsection: 'Subsection',
    part: 'Part',
    chapter: 'Chapter',
    table: 'Table',
    figure: 'Figure',
    appendix: 'Appendix',
    note: 'Note',
  };
  return known[lower] ?? prefix;
}
