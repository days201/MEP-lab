import { describe, expect, it } from 'vitest';
import {
  hasExpectedCodePattern,
  scorePageExtractionQuality,
} from '../src/main/mcp/building-code/page-quality';

describe('building-code page extraction quality scoring', () => {
  it('does not flag a normal selectable-text code page as suspicious', () => {
    const score = scorePageExtractionQuality({
      pageNumber: 42,
      text: 'Section 9.10.3.1 Fire separations shall be provided between occupancies and shall comply with the requirements of this Part.',
      textItemCount: 24,
      imageAreaRatio: 0.05,
      tableLikeLineCount: 0,
      previousPageHadCodePattern: true,
      nextPageHasCodePattern: true,
    });

    expect(score).toMatchObject({
      pageNumber: 42,
      suspicious: false,
      reasons: [],
      metrics: {
        imageAreaRatio: 0.05,
        tableLikeLineCount: 0,
        hasCodePattern: true,
      },
    });
  });

  it('flags a blank-looking image-heavy page as suspicious', () => {
    const score = scorePageExtractionQuality({
      pageNumber: 7,
      text: '',
      textItemCount: 0,
      imageAreaRatio: 0.82,
      tableLikeLineCount: 0,
      previousPageHadCodePattern: false,
      nextPageHasCodePattern: false,
    });

    expect(score).toMatchObject({
      pageNumber: 7,
      suspicious: true,
      reasons: ['image-heavy page has too little native text'],
      metrics: {
        charCount: 0,
        wordCount: 0,
        imageAreaRatio: 0.82,
      },
    });
  });

  it('flags garbled native text with replacement and null characters as suspicious', () => {
    const score = scorePageExtractionQuality({
      pageNumber: 8,
      text: '���\u0000���\u0000Section\u0000',
      textItemCount: 4,
      imageAreaRatio: 0,
      tableLikeLineCount: 0,
      previousPageHadCodePattern: false,
      nextPageHasCodePattern: false,
    });

    expect(score).toMatchObject({
      pageNumber: 8,
      suspicious: true,
      reasons: ['native text has too many unreadable characters'],
    });
    expect(score.metrics.unreadableRatio).toBeCloseTo(9 / 16);
  });

  it('flags low-text table-like pages as suspicious', () => {
    const score = scorePageExtractionQuality({
      pageNumber: 13,
      text: 'Table 9.10.3.1',
      textItemCount: 1,
      imageAreaRatio: 0.12,
      tableLikeLineCount: 12,
      previousPageHadCodePattern: false,
      nextPageHasCodePattern: false,
    });

    expect(score).toMatchObject({
      pageNumber: 13,
      suspicious: true,
      reasons: ['table-like geometry has little extracted cell text'],
      metrics: {
        tableLikeLineCount: 12,
        hasCodePattern: true,
      },
    });
  });

  it('treats missing code patterns near code pages as a soft signal only', () => {
    const score = scorePageExtractionQuality({
      pageNumber: 21,
      text: 'This introductory material describes the purpose and organization of the publication for readers before the technical requirements begin.',
      textItemCount: 18,
      imageAreaRatio: 0,
      tableLikeLineCount: 0,
      previousPageHadCodePattern: true,
      nextPageHasCodePattern: false,
    });

    expect(score).toMatchObject({
      pageNumber: 21,
      suspicious: false,
      reasons: [],
      softReasons: ['near code pages but lacks expected code patterns'],
      metrics: {
        hasCodePattern: false,
        imageAreaRatio: 0,
      },
    });
  });

  it('recognizes common building-code reference labels conservatively', () => {
    expect(hasExpectedCodePattern('Part 9')).toBe(true);
  });
});
