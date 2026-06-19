import { createHash } from 'node:crypto';
import { buildDisplayCitation } from './citation';
import type {
  CodeCitation,
  CodeNodeRecord,
  CodeNodeType,
  CodeParserProvenance,
  CodeSourceRecord,
} from './types';
import type { PageText } from './pdf-extract';

interface HeadingMatch {
  logicalRef: string;
  title: string;
  nodeType: CodeNodeType;
}

interface StackEntry {
  level: number;
  node: CodeNodeRecord;
}

export function checksumText(text: string): string {
  return `sha256:${hashText(text, 64)}`;
}

export function stableNodeId(
  sourceChecksum: string,
  logicalRef: string,
  nodeType: CodeNodeType
): string {
  return `code-node-${hashText(`${sourceChecksum}:${logicalRef}:${nodeType}`, 16)}`;
}

export function stableRecordId(prefix: string, parts: string[]): string {
  return `${prefix}-${hashText(parts.join(':'), 16)}`;
}

export function buildHierarchyFromPageTexts(
  pages: PageText[],
  source: CodeSourceRecord
): CodeNodeRecord[] {
  const nodes: CodeNodeRecord[] = [];
  const stack: StackEntry[] = [];
  const documentHeadingPath: string[] = [];

  for (const page of pages) {
    const lines = page.text.split(/\r?\n/);

    for (const line of lines) {
      const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (heading) {
        const level = heading[1].length;
        const headingText = heading[2].trim();

        if (level === 1) {
          documentHeadingPath.length = 0;
          documentHeadingPath.push(headingText);
          continue;
        }

        const matchedHeading = parseCanonicalHeading(headingText);
        if (!matchedHeading) {
          continue;
        }

        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }

        const parent = stack.at(-1)?.node ?? null;
        const headingPath = [
          ...documentHeadingPath,
          ...stack.map((entry) => displayHeading(entry.node)),
          headingText,
        ];
        const node: CodeNodeRecord = {
          nodeId: stableNodeId(
            source.sourceChecksum,
            matchedHeading.logicalRef,
            matchedHeading.nodeType
          ),
          sourceId: source.sourceId,
          documentId: source.documentId,
          nodeType: matchedHeading.nodeType,
          logicalRef: matchedHeading.logicalRef,
          title: matchedHeading.title,
          text: '',
          pageRange: String(page.pageNumber),
          headingPath,
          parentNodeId: parent?.nodeId ?? null,
          childNodeIds: [],
          extractionConfidence: 1,
          parser: parserProvenanceForPage(source, page),
        };

        if (parent) {
          parent.childNodeIds.push(node.nodeId);
        }

        nodes.push(node);
        stack.push({ level, node });
        continue;
      }

      const currentNode = stack.at(-1)?.node;
      if (currentNode) {
        currentNode.text = appendNodeLine(currentNode.text, line);
        expandPageRange(currentNode, page.pageNumber);
      }
    }
  }

  for (const node of nodes) {
    node.text = node.text.trim();
  }

  return nodes;
}

export function buildCitation(source: CodeSourceRecord, node: CodeNodeRecord): CodeCitation {
  return {
    status: 'complete',
    citationId: stableRecordId('citation', [
      source.sourceChecksum,
      node.logicalRef,
      node.nodeType,
      node.pageRange,
    ]),
    sourceId: source.sourceId,
    documentId: node.documentId,
    codeFamily: source.codeFamily,
    edition: source.edition,
    jurisdictionScope: source.jurisdictionScope,
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    localSourcePath: source.localSourcePath,
    sourceChecksum: source.sourceChecksum,
    logicalRef: node.logicalRef,
    nodeType: node.nodeType,
    pageRange: node.pageRange,
    headingPath: node.headingPath,
    extractionConfidence: node.extractionConfidence,
    parser: node.parser,
    displayCitation: buildDisplayCitation({
      codeFamily: source.codeFamily,
      edition: source.edition,
      logicalRef: node.logicalRef,
    }),
  };
}

function parseCanonicalHeading(headingText: string): HeadingMatch | null {
  const match = headingText.match(
    /^(Section\s+\d+(?:\.\d+)*|Table\s+\d+(?:\.\d+)*|Figure\s+\d+(?:\.\d+)*|Appendix\s+[A-Z])(?:\s+(.+))?$/i
  );
  if (!match) {
    return null;
  }

  const logicalRef = normalizeLogicalRef(match[1]);
  const title = match[2]?.trim() || logicalRef;

  return {
    logicalRef,
    title,
    nodeType: nodeTypeForLogicalRef(logicalRef),
  };
}

function nodeTypeForLogicalRef(logicalRef: string): CodeNodeType {
  if (logicalRef.startsWith('Table ')) {
    return 'table';
  }
  if (logicalRef.startsWith('Figure ')) {
    return 'figure';
  }
  if (logicalRef.startsWith('Appendix ')) {
    return 'appendix';
  }

  return 'section';
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

function appendNodeLine(currentText: string, line: string): string {
  if (!currentText) {
    return line;
  }

  return `${currentText}\n${line}`;
}

function expandPageRange(node: CodeNodeRecord, pageNumber: number): void {
  const [startPageText, endPageText] = node.pageRange.split('-');
  const startPage = Number(startPageText);
  const endPage = Number(endPageText ?? startPageText);

  if (!Number.isFinite(startPage) || !Number.isFinite(endPage) || pageNumber <= endPage) {
    return;
  }

  node.pageRange = pageNumber === startPage ? String(startPage) : `${startPage}-${pageNumber}`;
  node.parser.pageRange = node.pageRange;
}

function displayHeading(node: CodeNodeRecord): string {
  return node.title === node.logicalRef ? node.logicalRef : `${node.logicalRef} ${node.title}`;
}

function parserProvenanceForPage(
  source: CodeSourceRecord,
  page: PageText
): CodeParserProvenance {
  const isFixture = source.sourceUrl.startsWith('fixture://');

  return {
    name: isFixture ? 'fixture' : 'docling',
    version: isFixture ? 'test-fixture' : 'unknown',
    sourceElementIds: [],
    pageRange: String(page.pageNumber),
    boundingBoxes: [],
  };
}

function hashText(text: string, length: number): string {
  return createHash('sha256').update(text).digest('hex').slice(0, length);
}
