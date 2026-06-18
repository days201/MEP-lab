export interface PageText {
  pageNumber: number;
  text: string;
  sourceOffsetStart: number;
  sourceOffsetEnd: number;
}

export function pageTextsFromMarkdownFixture(markdown: string): PageText[] {
  return [
    {
      pageNumber: 1,
      text: markdown,
      sourceOffsetStart: 0,
      sourceOffsetEnd: markdown.length,
    },
  ];
}

export async function extractPdfPageTexts(): Promise<PageText[]> {
  throw new Error('PDF extraction is not implemented for fixture-first ingestion');
}
