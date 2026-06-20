import { describe, expect, it } from 'vitest';
import { scorePageExtractionQuality } from '../src/main/mcp/building-code/page-quality';

describe('building-code page extraction quality scoring', () => {
  it('does not flag a normal selectable-text code page as suspicious', () => {
    expect(
      scorePageExtractionQuality({
        text: 'Section 9.10.3.1 Fire separations shall be provided between occupancies and shall comply with the requirements of this Part.',
        textItemCount: 24,
        imageAreaRatio: 0.05,
        tableLikeLineCount: 0,
        previousPageHasCodePattern: true,
        nextPageHasCodePattern: true,
      })
    ).toMatchObject({
      suspicious: false,
      reasons: [],
    });
  });

  it('flags a blank-looking image-heavy page as suspicious', () => {
    expect(
      scorePageExtractionQuality({
        text: '',
        textItemCount: 0,
        imageAreaRatio: 0.82,
        tableLikeLineCount: 0,
      })
    ).toMatchObject({
      suspicious: true,
      reasons: ['image-heavy page has too little native text'],
    });
  });

  it('flags garbled native text with replacement and null characters as suspicious', () => {
    expect(
      scorePageExtractionQuality({
        text: '���\u0000���\u0000Section\u0000',
        textItemCount: 4,
        imageAreaRatio: 0,
        tableLikeLineCount: 0,
      })
    ).toMatchObject({
      suspicious: true,
      reasons: ['native text has too many unreadable characters'],
    });
  });

  it('flags low-text table-like pages as suspicious', () => {
    expect(
      scorePageExtractionQuality({
        text: 'Table 9.10.3.1',
        textItemCount: 1,
        imageAreaRatio: 0.12,
        tableLikeLineCount: 12,
      })
    ).toMatchObject({
      suspicious: true,
      reasons: ['table-like geometry has little extracted cell text'],
    });
  });

  it('treats missing code patterns near code pages as a soft signal only', () => {
    expect(
      scorePageExtractionQuality({
        text: 'This introductory material describes the purpose and organization of the publication for readers before the technical requirements begin.',
        textItemCount: 18,
        imageAreaRatio: 0,
        tableLikeLineCount: 0,
        previousPageHasCodePattern: true,
        nextPageHasCodePattern: true,
      })
    ).toMatchObject({
      suspicious: false,
      reasons: [],
      softReasons: ['near code pages but lacks expected code patterns'],
    });
  });
});
