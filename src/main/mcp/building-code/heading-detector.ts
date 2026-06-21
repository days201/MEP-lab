import type { CodeNodeType } from './types';

export interface DetectedBuildingCodeHeading {
  logicalRef: string;
  title: string;
  nodeType: CodeNodeType;
  level: number;
}

const prefixedPatterns: Array<{
  pattern: RegExp;
  prefix: string;
  nodeType: CodeNodeType;
  level: number;
}> = [
  {
    pattern: /^(Section)\s+(\d+(?:\.\d+)*\.?)(?:\s+(.+))?$/i,
    prefix: 'Section',
    nodeType: 'section',
    level: 2,
  },
  {
    pattern: /^(Subsection)\s+(\d+(?:\.\d+)*\.?)(?:\s+(.+))?$/i,
    prefix: 'Subsection',
    nodeType: 'subsection',
    level: 3,
  },
  {
    pattern: /^(Article)\s+(\d+(?:\.\d+)*\.?)(?:\s+(.+))?$/i,
    prefix: 'Article',
    nodeType: 'section',
    level: 4,
  },
  {
    pattern: /^(Sentence)\s+(\d+(?:\.\d+)*(?:\.\(\d+\))?\.?)(?:\s+(.+))?$/i,
    prefix: 'Sentence',
    nodeType: 'section',
    level: 5,
  },
  { pattern: /^(Part)\s+(\d+)(?:\s+(.+))?$/i, prefix: 'Part', nodeType: 'section', level: 1 },
  {
    pattern: /^(Chapter)\s+(\d+)(?:\s+(.+))?$/i,
    prefix: 'Chapter',
    nodeType: 'section',
    level: 1,
  },
  { pattern: /^(Table)\s+(\d+(?:\.\d+)*\.?)(?:\s+(.+))?$/i, prefix: 'Table', nodeType: 'table', level: 3 },
  {
    pattern: /^(Figure)\s+(\d+(?:\.\d+)*\.?)(?:\s+(.+))?$/i,
    prefix: 'Figure',
    nodeType: 'figure',
    level: 3,
  },
  {
    pattern: /^(Appendix)\s+([A-Z])(?:\s+(.+))?$/i,
    prefix: 'Appendix',
    nodeType: 'appendix',
    level: 1,
  },
  {
    pattern: /^(Note)\s+([A-Z]-\d+(?:\.\d+)*\.?)(?:\s+(.+))?$/i,
    prefix: 'Note',
    nodeType: 'note',
    level: 4,
  },
];

export function detectBuildingCodeHeading(text: string): DetectedBuildingCodeHeading | null {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return null;
  }

  for (const candidate of prefixedPatterns) {
    const match = normalized.match(candidate.pattern);
    if (!match) {
      continue;
    }
    const refNumber = stripTrailingDot(match[2]);
    const logicalRef = `${candidate.prefix} ${refNumber}`;
    const title = match[3]?.trim() || logicalRef;
    if (isBodyProseTitle(title) || isTableCaptionNoise(title)) {
      return null;
    }
    return {
      logicalRef,
      title,
      nodeType: candidate.nodeType,
      level: candidate.level,
    };
  }

  const bareNumeric = normalized.match(/^(\d+(?:\.\d+){2,}\.?)(?:\s+(.+))?$/);
  if (bareNumeric) {
    const logicalRef = `Section ${stripTrailingDot(bareNumeric[1])}`;
    const title = bareNumeric[2]?.trim() || logicalRef;
    if (isBodyProseTitle(title) || isTableCaptionNoise(title)) {
      return null;
    }
    return {
      logicalRef,
      title,
      nodeType: 'section',
      level: 4,
    };
  }

  return null;
}

function stripTrailingDot(value: string): string {
  return value.replace(/\.$/, '');
}

function isBodyProseTitle(title: string): boolean {
  const trimmed = title.trim();
  const continuationReference = /^(?:and|or)\s+(?:Section|Subsection|Article|Sentence|Part|Chapter|Table|Figure|Appendix|Note)\b/i;
  if (continuationReference.test(trimmed)) {
    return true;
  }

  const bodyProsePhrases = [
    /^(?:applies?|requires?)\b.+[.!?]$/i,
    /^(?:shall|must|may)\b.+[.!?]$/i,
    /^(?:is|are)\b.+[.!?]$/i,
    /^(?:includes?|does|do)\b.+[.!?]$/i,
  ];

  return bodyProsePhrases.some((pattern) => pattern.test(trimmed));
}

function isTableCaptionNoise(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) {
    return false;
  }

  const startsLikeProse = /^(?:lists?|shows?|describes?|indicates?|contains?|includes?|provides?|requires?|applies?|continues?|follows?)\b/i.test(
    trimmed
  );
  const sentenceLike =
    /[.!?]$/.test(trimmed) ||
    /[.!?]/.test(trimmed) ||
    /\b(?:and|or|but|because|when|where|while|which|that|if|unless|until)\b/i.test(trimmed);

  return /\|/.test(trimmed) || (startsLikeProse && sentenceLike);
}
