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
    const paragraphChunks = splitLongParagraph(paragraph);

    for (const paragraphChunk of paragraphChunks) {
      const candidate = current ? `${current}\n\n${paragraphChunk}` : paragraphChunk;
      if (candidate.length <= maxChunkLength) {
        current = candidate;
        continue;
      }

      if (current) {
        chunks.push(current);
      }
      current = paragraphChunk;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitLongParagraph(paragraph: string): string[] {
  const chunks: string[] = [];
  let remaining = paragraph;

  while (remaining.length > maxChunkLength) {
    const splitAt = findWhitespaceSplit(remaining) ?? maxChunkLength;
    const chunk = remaining.slice(0, splitAt).trimEnd();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function findWhitespaceSplit(text: string): number | undefined {
  const earliestSplit = Math.floor(maxChunkLength * 0.75);

  for (let index = maxChunkLength; index >= earliestSplit; index -= 1) {
    if (/\s/.test(text[index])) {
      return index;
    }
  }

  return undefined;
}
