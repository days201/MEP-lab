import { describe, expect, it } from 'vitest';
import { detectBuildingCodeHeading } from '../src/main/mcp/building-code/heading-detector';

describe('building-code canonical adapter', () => {
  it.each([
    ['Section 9.10.3.1 Fire separations', 'Section 9.10.3.1', 'section'],
    ['Article 3.2.2.20. Sprinklers', 'Article 3.2.2.20', 'section'],
    ['Sentence 9.10.3.1.(1) Application', 'Sentence 9.10.3.1.(1)', 'section'],
    ['Subsection 4.1.5. Loads', 'Subsection 4.1.5', 'subsection'],
    ['Part 6 HVAC', 'Part 6', 'section'],
    ['Chapter 5 Environmental Separation', 'Chapter 5', 'section'],
    ['Table 7.3.1 Refrigerants', 'Table 7.3.1', 'table'],
    ['Figure 3.1.4 Diagram', 'Figure 3.1.4', 'figure'],
    ['Appendix A Explanatory Material', 'Appendix A', 'appendix'],
    ['Note A-3.2.1. Fire-resistance ratings', 'Note A-3.2.1', 'note'],
    ['9.10.3.1 Fire separations', 'Section 9.10.3.1', 'section'],
  ])('detects %s', (text, logicalRef, nodeType) => {
    expect(detectBuildingCodeHeading(text)).toMatchObject({ logicalRef, nodeType });
  });

  it('detects all-caps chapter headings without inventing a logical ref', () => {
    expect(detectBuildingCodeHeading('PART 3 FIRE PROTECTION')).toMatchObject({
      logicalRef: 'Part 3',
      title: 'FIRE PROTECTION',
      nodeType: 'section',
    });
  });

  it('ignores ordinary body text', () => {
    expect(detectBuildingCodeHeading('This sentence references Section 9.10.3.1 in prose.')).toBeNull();
  });
});
