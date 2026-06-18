export type CodeNodeType =
  | 'section'
  | 'subsection'
  | 'table'
  | 'table-row'
  | 'table-note'
  | 'figure'
  | 'definition'
  | 'appendix'
  | 'note';

export type CitationStatus = 'complete' | 'partial';

export interface CodeSourceRecord {
  sourceId: string;
  codeFamily: string;
  edition: string;
  jurisdictionScope: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceChecksum: string;
}

export interface CodeCitation {
  status: CitationStatus;
  citationId: string;
  sourceId: string;
  codeFamily: string;
  edition: string;
  jurisdictionScope: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceChecksum: string;
  logicalRef: string;
  nodeType: CodeNodeType;
  pageRange: string;
  headingPath: string[];
  displayCitation: string;
}

export interface CodeNodeRecord {
  nodeId: string;
  sourceId: string;
  nodeType: CodeNodeType;
  logicalRef: string;
  title: string;
  text: string;
  pageRange: string;
  headingPath: string[];
  parentNodeId: string | null;
  childNodeIds: string[];
  tableId?: string;
  extractionConfidence: number;
}

export interface CodeChunkRecord {
  chunkId: string;
  sourceId: string;
  nodeId: string;
  text: string;
  pageRange: string;
  embeddingCacheKey: string;
}

export interface CodeVectorRecord {
  chunkId: string;
  embeddingModel: string;
  embedding: number[];
  embeddingTextHash: string;
}

export interface CodeCrossReferenceRecord {
  fromNodeId: string;
  rawText: string;
  targetLogicalRef: string;
  targetNodeId: string | null;
  status: 'resolved' | 'unresolved';
}

export interface CodeTableRecord {
  tableId: string;
  nodeId: string;
  caption: string;
  columns: string[];
  rows: Array<{ rowId: string; cells: string[]; citation: CodeCitation }>;
  notes: Array<{ noteId: string; text: string; citation: CodeCitation }>;
}

export interface BuildingCodeEvidence {
  evidenceId: string;
  nodeId: string;
  evidenceKind: 'section' | 'table-row' | 'table-note' | 'cross-reference';
  excerpt: string;
  fullText?: string;
  applicabilityNotes: string[];
  citation: CodeCitation;
}
