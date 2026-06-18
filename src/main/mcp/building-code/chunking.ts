import { stableRecordId } from './hierarchy';
import type { CodeChunkRecord, CodeNodeRecord, CodeSourceRecord } from './types';

const maxChunkLength = 800;

export function buildNodeChunks(
  nodes: CodeNodeRecord[],
  source: CodeSourceRecord
): CodeChunkRecord[] {
  const chunks: CodeChunkRecord[] = [];

  for (const node of nodes) {
    const text = node.text.trim();
    if (!text) {
      continue;
    }

    splitNodeText(text).forEach((chunkText, index) => {
      chunks.push({
        chunkId: stableRecordId('chunk', [
          source.sourceChecksum,
          node.nodeId,
          String(index),
          chunkText,
        ]),
        sourceId: source.sourceId,
        nodeId: node.nodeId,
        text: chunkText,
        pageRange: node.pageRange,
        embeddingCacheKey: stableRecordId('embedding-text', [
          source.sourceChecksum,
          node.nodeId,
          chunkText,
        ]),
      });
    });
  }

  return chunks;
}

function splitNodeText(text: string): string[] {
  if (text.length <= maxChunkLength) {
    return [text];
  }

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChunkLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = paragraph;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
