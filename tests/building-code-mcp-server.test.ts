import { describe, expect, it } from 'vitest';
import { createFromBuildingCodePreset, handleBuildingCodeTool, listBuildingCodeTools } from '../src/main/mcp/building-code-server';

describe('building-code MCP server surface', () => {
  it('exposes exactly the low-level building-code tools', () => {
    expect(listBuildingCodeTools().map((tool) => tool.name)).toEqual([
      'search',
      'read_section',
      'resolve_cross_refs',
      'lookup_table',
    ]);
  });

  it('handles fixture-backed search, section read, reference resolution, and table lookup', async () => {
    const searchResult = await handleBuildingCodeTool('search', {
      query: 'R-32 flammable refrigerant',
      fixture: true,
    });
    const sectionResult = await handleBuildingCodeTool('read_section', {
      ref: 'Section 7.3',
      fixture: true,
    });
    const refsResult = await handleBuildingCodeTool('resolve_cross_refs', {
      ref: 'Section 7.3',
      fixture: true,
    });
    const tableResult = await handleBuildingCodeTool('lookup_table', {
      ref: 'Table 7.3.1',
      filters: { Refrigerant: 'R-32' },
      fixture: true,
    });

    expect(searchResult.content).toEqual(expect.any(Array));
    expect(JSON.stringify(sectionResult)).toContain('"displayCitation"');
    expect(JSON.stringify(refsResult)).toContain('"displayCitation"');
    expect(JSON.stringify(tableResult)).toContain('"displayCitation"');
  });

  it('defines a Building_Code preset that resolves the bundled server path', () => {
    const preset = createFromBuildingCodePreset();

    expect(preset.name).toBe('Building_Code');
    expect(preset.args?.[0]).toMatch(/building-code-server\.(js|ts)$/);
    expect(preset.args?.[0]).not.toBe('{BUILDING_CODE_SERVER_PATH}');
  });
});
