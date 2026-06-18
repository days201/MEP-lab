import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const pluginRoot = path.join(repoRoot, '.claude/plugins/building-code');

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(pluginRoot, relativePath), 'utf8');
}

describe('building-code built-in plugin scaffold', () => {
  it('declares the building-code skill instructions and MCP server placeholder', () => {
    const skill = readText('skills/building-code/SKILL.md');
    const mcp = JSON.parse(readText('.mcp.json'));

    expect(skill).toContain('name: building-code');
    expect(skill).toContain('search');
    expect(skill).toContain('read_section');
    expect(skill).toContain('resolve_cross_refs');
    expect(skill).toContain('lookup_table');
    expect(skill).toContain('Sources:');
    expect(skill).toContain('unusable');
    expect(mcp.mcpServers.Building_Code.args).toEqual(['{BUILDING_CODE_SERVER_PATH}']);
  });

  it('packages built-in plugins for every electron-builder target', () => {
    const builderConfig = fs.readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf8');

    for (const platform of ['win', 'mac', 'linux']) {
      const platformBlock = builderConfig.match(
        new RegExp(`${platform}:\\n[\\s\\S]*?(?=\\n(?:win|mac|linux|nsis):)`)
      )?.[0];

      expect(platformBlock).toContain('from: .claude/plugins');
      expect(platformBlock).toContain('to: plugins');
    }
  });
});
