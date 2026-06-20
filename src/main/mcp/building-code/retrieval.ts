import { buildCitation } from './hierarchy';
import type { BuildingCodeEmbeddingClient } from './embedding';
import { isBuildingCodeIndexEmpty, type BuildingCodeIndex } from './index-store';
import type {
  BuildingCodeEvidence,
  CodeCrossReferenceRecord,
  CodeNodeRecord,
  CodeTableRecord,
  CodeVectorRecord,
} from './types';

export interface BuildingCodeToolDiagnostics {
  unresolvedReferences: CodeCrossReferenceRecord[];
  quarantinedChunks: Array<{ chunkId: string; reason: string }>;
  embedding: { model: string; cacheHits: number; cacheMisses: number };
}

export interface BuildingCodeToolResult {
  results: BuildingCodeEvidence[];
  diagnostics: BuildingCodeToolDiagnostics;
}

export interface SearchBuildingCodeInput {
  query: string;
  embeddingClient: BuildingCodeEmbeddingClient;
  limit?: number;
}

export interface ReadSectionInput {
  ref: string;
  includeChildren?: boolean;
}

export interface ResolveCrossRefsInput {
  ref: string;
  depth?: 1 | 2;
}

export interface LookupTableInput {
  ref: string;
  filters?: Record<string, string>;
  query?: string;
}

interface CandidateScore {
  chunkId: string;
  score: number;
}

export class EmptyBuildingCodeIndexError extends Error {
  constructor() {
    super('Building_Code knowledge base is empty. Upload documents in Settings > Knowledge Base.');
    this.name = 'EmptyBuildingCodeIndexError';
  }
}

export class BuildingCodeSemanticSearchUnavailableError extends Error {
  constructor() {
    super('Building_Code semantic search is unavailable because embeddings are not available for the active index.');
    this.name = 'BuildingCodeSemanticSearchUnavailableError';
  }
}

export async function searchBuildingCode(
  index: BuildingCodeIndex,
  input: SearchBuildingCodeInput
): Promise<BuildingCodeToolResult> {
  assertReadableIndex(index);
  if (!index.semanticSearchAvailable || index.vectors.length === 0) {
    throw new BuildingCodeSemanticSearchUnavailableError();
  }

  const [queryEmbedding] = await input.embeddingClient.embed([input.query]);
  const limit = clampLimit(input.limit);
  const candidateScores = semanticCandidateSearch(
    queryEmbedding,
    index.vectors.filter((vector) => vector.embeddingModel === input.embeddingClient.model),
    Math.max(limit * 4, 8)
  );
  const chunksById = new Map(index.chunks.map((chunk) => [chunk.chunkId, chunk]));
  const nodesById = new Map(index.nodes.map((node) => [node.nodeId, node]));
  const bestScoresByNodeId = new Map<string, number>();
  const quarantinedChunks: Array<{ chunkId: string; reason: string }> = [];

  for (const candidate of candidateScores) {
    const chunk = chunksById.get(candidate.chunkId);
    if (!chunk) {
      quarantinedChunks.push({ chunkId: candidate.chunkId, reason: 'candidate chunk is missing' });
      continue;
    }

    const node = nodesById.get(chunk.nodeId);
    if (!node) {
      quarantinedChunks.push({
        chunkId: candidate.chunkId,
        reason: 'candidate chunk does not map to a canonical node',
      });
      continue;
    }

    const boostedScore = candidate.score + lexicalBoost(input.query, node);
    bestScoresByNodeId.set(node.nodeId, Math.max(bestScoresByNodeId.get(node.nodeId) ?? -1, boostedScore));
  }

  const rankedNodes = [...bestScoresByNodeId.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([nodeId]) => nodesById.get(nodeId))
    .filter((node): node is CodeNodeRecord => Boolean(node))
    .slice(0, limit);

  return {
    results: rankedNodes.map((node) => evidenceForNode(index, node, 'section')),
    diagnostics: diagnostics(input.embeddingClient.model, index.chunks.length, 0, quarantinedChunks),
  };
}

export function semanticCandidateSearch(
  queryEmbedding: number[],
  vectors: CodeVectorRecord[],
  limit: number
): CandidateScore[] {
  return vectors
    .map((vector) => ({
      chunkId: vector.chunkId,
      score: cosineSimilarity(queryEmbedding, vector.embedding),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function readSection(index: BuildingCodeIndex, input: ReadSectionInput): BuildingCodeToolResult {
  assertReadableIndex(index);
  const node = resolveNode(index, input.ref);
  const nodes = input.includeChildren
    ? [node, ...node.childNodeIds.map((nodeId) => resolveNode(index, nodeId))]
    : [node];

  return {
    results: nodes.map((item) => evidenceForNode(index, item, 'section', true)),
    diagnostics: diagnostics(),
  };
}

export function resolveCrossRefsForNode(
  index: BuildingCodeIndex,
  input: ResolveCrossRefsInput
): BuildingCodeToolResult {
  assertReadableIndex(index);
  const startNode = resolveNode(index, input.ref);
  const maxDepth = input.depth === 2 ? 2 : 1;
  const visited = new Set<string>([startNode.nodeId]);
  const unresolvedReferences: CodeCrossReferenceRecord[] = [];
  const evidence: BuildingCodeEvidence[] = [];

  collectCrossRefs(index, startNode.nodeId, maxDepth, visited, evidence, unresolvedReferences);

  return {
    results: evidence,
    diagnostics: diagnostics(undefined, 0, 0, [], unresolvedReferences),
  };
}

export function lookupTable(index: BuildingCodeIndex, input: LookupTableInput): BuildingCodeToolResult {
  assertReadableIndex(index);
  const table = resolveTable(index, input.ref);
  const tableNode = resolveNode(index, table.nodeId);
  const matchingRows = table.rows.filter((row) => rowMatchesFilters(table, row.cells, input.filters));
  const rowEvidence = matchingRows.map((row) => ({
    evidenceId: row.rowId,
    nodeId: table.nodeId,
    evidenceKind: 'table-row' as const,
    excerpt: table.columns.map((column, index) => `${column}: ${row.cells[index] ?? ''}`).join('; '),
    fullText: `${table.caption}\n${table.columns.join(' | ')}\n${row.cells.join(' | ')}`,
    applicabilityNotes: table.notes.map((note) => note.text),
    citation: row.citation,
  }));
  const noteEvidence = table.notes.map((note) => ({
    evidenceId: note.noteId,
    nodeId: table.nodeId,
    evidenceKind: 'table-note' as const,
    excerpt: note.text,
    fullText: note.text,
    applicabilityNotes: [],
    citation: note.citation,
  }));

  return {
    results: [
      evidenceForNode(index, tableNode, 'section', true),
      ...rowEvidence,
      ...noteEvidence,
    ],
    diagnostics: diagnostics(),
  };
}

function assertReadableIndex(index: BuildingCodeIndex): void {
  if (isBuildingCodeIndexEmpty(index)) {
    throw new EmptyBuildingCodeIndexError();
  }
}

function collectCrossRefs(
  index: BuildingCodeIndex,
  nodeId: string,
  depthRemaining: number,
  visited: Set<string>,
  evidence: BuildingCodeEvidence[],
  unresolvedReferences: CodeCrossReferenceRecord[]
): void {
  if (depthRemaining <= 0) {
    return;
  }

  const refs = index.crossReferences.filter((reference) => reference.fromNodeId === nodeId);
  for (const reference of refs) {
    if (!reference.targetNodeId || reference.status !== 'resolved') {
      unresolvedReferences.push(reference);
      continue;
    }

    if (visited.has(reference.targetNodeId)) {
      continue;
    }

    const target = resolveNode(index, reference.targetNodeId);
    visited.add(target.nodeId);
    evidence.push(evidenceForNode(index, target, 'cross-reference', true));
    collectCrossRefs(index, target.nodeId, depthRemaining - 1, visited, evidence, unresolvedReferences);
  }
}

function evidenceForNode(
  index: BuildingCodeIndex,
  node: CodeNodeRecord,
  evidenceKind: BuildingCodeEvidence['evidenceKind'],
  forceFullText = false
): BuildingCodeEvidence {
  const source = index.sources.find((source) => source.sourceId === node.sourceId);
  if (!source) {
    throw new Error(`Source not found for node ${node.nodeId}`);
  }

  const fullText = node.text.trim();
  const excerpt = fullText.length > 360 ? `${fullText.slice(0, 357).trimEnd()}...` : fullText;

  return {
    evidenceId: `evidence-${node.nodeId}`,
    nodeId: node.nodeId,
    evidenceKind,
    excerpt,
    fullText: forceFullText || fullText.length <= 800 ? fullText : undefined,
    applicabilityNotes: [],
    citation: buildCitation(source, node),
  };
}

function resolveNode(index: BuildingCodeIndex, ref: string): CodeNodeRecord {
  const normalized = normalizeRef(ref);
  const node = index.nodes.find(
    (candidate) =>
      candidate.nodeId === ref ||
      candidate.logicalRef === normalized ||
      buildCitationForRef(index, candidate)?.citationId === ref
  );

  if (!node) {
    throw new Error(`Building-code node not found: ${ref}`);
  }

  return node;
}

function resolveTable(index: BuildingCodeIndex, ref: string): CodeTableRecord {
  const normalized = normalizeRef(ref);
  const table = index.tables.find((candidate) => {
    const node = index.nodes.find((node) => node.nodeId === candidate.nodeId);

    return candidate.tableId === ref || node?.logicalRef === normalized;
  });

  if (!table) {
    throw new Error(`Building-code table not found: ${ref}`);
  }

  return table;
}

function rowMatchesFilters(
  table: CodeTableRecord,
  cells: string[],
  filters: Record<string, string> | undefined
): boolean {
  if (!filters || Object.keys(filters).length === 0) {
    return true;
  }

  return Object.entries(filters).every(([rawColumn, rawValue]) => {
    const columnIndex = table.columns.findIndex(
      (column) => column.toLowerCase() === rawColumn.toLowerCase()
    );
    if (columnIndex < 0) {
      return false;
    }

    return (cells[columnIndex] ?? '').toLowerCase() === rawValue.toLowerCase();
  });
}

function buildCitationForRef(index: BuildingCodeIndex, node: CodeNodeRecord) {
  const source = index.sources.find((source) => source.sourceId === node.sourceId);

  return source ? buildCitation(source, node) : null;
}

function lexicalBoost(query: string, node: CodeNodeRecord): number {
  const haystack = `${node.logicalRef} ${node.title} ${node.text}`.toLowerCase();
  const queryText = query.toLowerCase();
  let boost = 0;

  for (const token of queryText.split(/[^a-z0-9.-]+/i).filter((token) => token.length > 1)) {
    if (haystack.includes(token)) {
      boost += 0.12;
    }
  }

  if (node.nodeType === 'table' && /value|table|r-\d|edvc|rcl/i.test(query)) {
    boost += 0.5;
  }

  return boost;
}

function diagnostics(
  model = '',
  cacheHits = 0,
  cacheMisses = 0,
  quarantinedChunks: Array<{ chunkId: string; reason: string }> = [],
  unresolvedReferences: CodeCrossReferenceRecord[] = []
): BuildingCodeToolDiagnostics {
  return {
    unresolvedReferences,
    quarantinedChunks,
    embedding: { model, cacheHits, cacheMisses },
  };
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function normalizeRef(ref: string): string {
  return ref
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^section\b/i, 'Section')
    .replace(/^table\b/i, 'Table')
    .replace(/^figure\b/i, 'Figure')
    .replace(/^appendix\b/i, 'Appendix');
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit) {
    return 5;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 20);
}
