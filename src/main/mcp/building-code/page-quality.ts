export interface PageQualityInput {
  pageNumber: number;
  text: string;
  textItemCount: number;
  imageAreaRatio: number;
  tableLikeLineCount: number;
  previousPageHadCodePattern?: boolean;
  nextPageHasCodePattern?: boolean;
}

export interface PageQualityMetrics {
  charCount: number;
  wordCount: number;
  unreadableRatio: number;
  spacedCharacterRatio: number;
  imageAreaRatio: number;
  tableLikeLineCount: number;
  hasCodePattern: boolean;
}

export interface PageQualityScore {
  pageNumber: number;
  suspicious: boolean;
  reasons: string[];
  softReasons: string[];
  metrics: PageQualityMetrics;
}

export const PAGE_QUALITY_THRESHOLDS = {
  minNativeCharacters: 80,
  minNativeWords: 12,
  imageHeavyAreaRatio: 0.55,
  unreadableCharacterRatio: 0.08,
  spacedCharacterRatio: 0.45,
  tableLikeLineCount: 8,
  lowTableTextWords: 8,
} as const;

const CODE_PATTERN_REGEXES = [
  /\b(?:Section|Subsection|Article|Sentence|Part|Chapter|Table|Appendix|Note)\s+[A-Z]?\d+(?:\.\d+){0,6}\.?(?=\s|$|[),;:])/i,
  /\b(?:Section|Subsection|Article|Sentence|Part|Chapter|Table|Appendix|Note)\s+[A-Z]\b/i,
  /\b[A-Z]?\d+(?:\.\d+){1,6}\.?(?=\s|$|[),;:])/i,
];

export function hasExpectedCodePattern(text: string): boolean {
  return CODE_PATTERN_REGEXES.some((pattern) => pattern.test(text));
}

export function scorePageExtractionQuality(input: PageQualityInput): PageQualityScore {
  const text = input.text ?? '';
  const charCount = countNativeCharacters(text);
  const wordCount = countWords(text);
  const unreadableRatio = calculateUnreadableRatio(text);
  const spacedCharacterRatio = calculateSpacedCharacterRatio(text);
  const imageAreaRatio = clampRatio(input.imageAreaRatio);
  const tableLikeLineCount = Math.max(0, input.tableLikeLineCount);
  const hasCodePattern = hasExpectedCodePattern(text);
  const nearCodePage = Boolean(input.previousPageHadCodePattern || input.nextPageHasCodePattern);

  const reasons: string[] = [];
  const softReasons: string[] = [];

  if (
    imageAreaRatio >= PAGE_QUALITY_THRESHOLDS.imageHeavyAreaRatio &&
    hasLowNativeText(charCount, wordCount)
  ) {
    reasons.push('image-heavy page has too little native text');
  }

  if (nearCodePage && hasLowNativeText(charCount, wordCount)) {
    reasons.push('nearby code page has unexpectedly low native text');
  }

  if (unreadableRatio > PAGE_QUALITY_THRESHOLDS.unreadableCharacterRatio) {
    reasons.push('native text has too many unreadable characters');
  }

  if (spacedCharacterRatio > PAGE_QUALITY_THRESHOLDS.spacedCharacterRatio) {
    reasons.push('native text appears to be extreme single-character spacing');
  }

  if (
    tableLikeLineCount >= PAGE_QUALITY_THRESHOLDS.tableLikeLineCount &&
    wordCount < PAGE_QUALITY_THRESHOLDS.lowTableTextWords
  ) {
    reasons.push('table-like geometry has little extracted cell text');
  }

  if (nearCodePage && !hasCodePattern && !hasLowNativeText(charCount, wordCount)) {
    softReasons.push('near code pages but lacks expected code patterns');
  }

  return {
    pageNumber: input.pageNumber,
    suspicious: reasons.length > 0,
    reasons,
    softReasons,
    metrics: {
      charCount,
      wordCount,
      unreadableRatio,
      spacedCharacterRatio,
      imageAreaRatio,
      tableLikeLineCount,
      hasCodePattern,
    },
  };
}

function hasLowNativeText(charCount: number, wordCount: number): boolean {
  return (
    charCount < PAGE_QUALITY_THRESHOLDS.minNativeCharacters ||
    wordCount < PAGE_QUALITY_THRESHOLDS.minNativeWords
  );
}

function countNativeCharacters(text: string): number {
  return text.replace(/[\s\u0000\uFFFD]/g, '').length;
}

function countWords(text: string): number {
  const words = text.match(/[A-Za-z0-9]+(?:[.'-][A-Za-z0-9]+)*/g);
  return words?.length ?? 0;
}

function calculateUnreadableRatio(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  const unreadableCount = text.match(/[\u0000\uFFFD]/g)?.length ?? 0;
  return unreadableCount / text.length;
}

function calculateSpacedCharacterRatio(text: string): number {
  const normalized = text.replace(/[\u0000\uFFFD]/g, ' ').trim();

  if (normalized.length === 0) {
    return 0;
  }

  const tokens = normalized.match(/[A-Za-z0-9]+/g) ?? [];
  if (tokens.length < PAGE_QUALITY_THRESHOLDS.minNativeWords) {
    return 0;
  }

  const singleCharacterTokens = tokens.filter((token) => token.length === 1).length;
  return singleCharacterTokens / tokens.length;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}
