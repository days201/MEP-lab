import { describe, expect, it } from 'vitest';
import { detectBuildingCodeHeading } from '../src/main/mcp/building-code/heading-detector';

describe('building-code canonical adapter', () => {
  describe('detectBuildingCodeHeading', () => {
    it.each([
      ['Section 9.10.3.1 Fire separations', 'Section 9.10.3.1', 'Fire separations', 'section', 2],
      ['Section 9.10.3.1 fire separations', 'Section 9.10.3.1', 'fire separations', 'section', 2],
      ['Article 3.2.2.20. Sprinklers', 'Article 3.2.2.20', 'Sprinklers', 'section', 4],
      ['Sentence 9.10.3.1.(1) Application', 'Sentence 9.10.3.1.(1)', 'Application', 'section', 5],
      ['Subsection 4.1.5. Loads', 'Subsection 4.1.5', 'Loads', 'subsection', 3],
      ['Part 6 HVAC', 'Part 6', 'HVAC', 'section', 1],
      ['Chapter 5 Environmental Separation', 'Chapter 5', 'Environmental Separation', 'section', 1],
      ['Table 7.3.1 Refrigerants', 'Table 7.3.1', 'Refrigerants', 'table', 3],
      ['Figure 3.1.4 Diagram', 'Figure 3.1.4', 'Diagram', 'figure', 3],
      ['Appendix A Explanatory Material', 'Appendix A', 'Explanatory Material', 'appendix', 1],
      ['Note A-3.2.1. Fire-resistance ratings', 'Note A-3.2.1', 'Fire-resistance ratings', 'note', 4],
      ['9.10.3.1 Fire separations', 'Section 9.10.3.1', 'Fire separations', 'section', 4],
      ['Section 3.4.1 Means of Egress', 'Section 3.4.1', 'Means of Egress', 'section', 2],
    ])('detects %s', (text, logicalRef, title, nodeType, level) => {
      expect(detectBuildingCodeHeading(text)).toMatchObject({ logicalRef, title, nodeType, level });
    });

    it('detects all-caps part headings without inventing a logical ref', () => {
      expect(detectBuildingCodeHeading('PART 3 FIRE PROTECTION')).toMatchObject({
        logicalRef: 'Part 3',
        title: 'FIRE PROTECTION',
        nodeType: 'section',
        level: 1,
      });
    });

    it('ignores ordinary body text', () => {
      expect(detectBuildingCodeHeading('This sentence references Section 9.10.3.1 in prose.')).toBeNull();
    });

    it.each([
      'Section 9.10.3.1 applies to fire separations.',
      'Article 3.2.2.20. requires sprinklers in this condition.',
      'Part 6 applies to HVAC systems.',
      '9.10.3.1 applies to fire separations.',
      'Section 9.10.3.1 and Section 9.10.3.2 apply to fire separations.',
    ])('ignores body prose that starts with a reference: %s', (text) => {
      expect(detectBuildingCodeHeading(text)).toBeNull();
    });
  });
});
