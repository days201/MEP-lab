import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { stageBundledServers } = require('../scripts/bundle-mcp.js');

const tempRoots: string[] = [];
describe('bundle-mcp staging', () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('stages bundled MCP servers into a fresh directory', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-bundle-mcp-'));
    tempRoots.push(tempRoot);

    const sourceDir = path.join(tempRoot, 'dist-mcp');
    const stagedDir = path.join(tempRoot, '.bundle-resources', 'mcp');

    fs.mkdirSync(sourceDir, { recursive: true });

    fs.writeFileSync(path.join(sourceDir, 'gui-operate-server.js'), 'module.exports = "gui";\n');
    fs.writeFileSync(
      path.join(sourceDir, 'building-code-server.js'),
      'module.exports = "building-code";\n'
    );
    fs.writeFileSync(
      path.join(sourceDir, 'software-dev-server-example.js'),
      'module.exports = "dev";\n'
    );

    await stageBundledServers(sourceDir, stagedDir, [
      { name: 'gui-operate-server' },
      { name: 'building-code-server' },
      { name: 'software-dev-server-example' },
    ]);

    expect(fs.readFileSync(path.join(stagedDir, 'gui-operate-server.js'), 'utf8')).toContain('gui');
    expect(fs.readFileSync(path.join(stagedDir, 'building-code-server.js'), 'utf8')).toContain(
      'building-code'
    );
    expect(
      fs.readFileSync(path.join(stagedDir, 'software-dev-server-example.js'), 'utf8')
    ).toContain('dev');

    expect(fs.existsSync(path.join(stagedDir, 'building-code'))).toBe(false);

    const tempEntries = fs
      .readdirSync(path.dirname(stagedDir))
      .filter((entry) => entry.includes('mcp.tmp-'));
    expect(tempEntries).toEqual([]);
  });

  it('does not stage a building-code sidecar directory when the building-code server is omitted', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-bundle-mcp-'));
    tempRoots.push(tempRoot);

    const sourceDir = path.join(tempRoot, 'dist-mcp');
    const stagedDir = path.join(tempRoot, '.bundle-resources', 'mcp');

    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'gui-operate-server.js'), 'module.exports = "gui";\n');

    await stageBundledServers(sourceDir, stagedDir, [{ name: 'gui-operate-server' }]);

    expect(fs.existsSync(path.join(stagedDir, 'building-code'))).toBe(false);
  });

  it('points electron-builder extraResources at the staged MCP directory', () => {
    const builderConfig = fs.readFileSync(
      path.resolve(process.cwd(), 'electron-builder.yml'),
      'utf8'
    );

    expect(builderConfig).toContain('.bundle-resources/mcp');
    expect(builderConfig).not.toContain('- from: dist-mcp');
  });

  it('bundles the building-code MCP server from the default server list', () => {
    const bundleScript = fs.readFileSync(path.resolve(process.cwd(), 'scripts/bundle-mcp.js'), 'utf8');

    expect(bundleScript).toContain("name: 'building-code-server'");
    expect(bundleScript).toContain("entry: 'building-code-server.ts'");
  });

  it('does not stage a Docling bridge beside bundled MCP assets', () => {
    const bundleScript = fs.readFileSync(path.join(process.cwd(), 'scripts/bundle-mcp.js'), 'utf8');
    expect(bundleScript).not.toContain('docling_bridge.py');
  });

  it('requires building-code MCP artifacts in default bundle output for release packaging', () => {
    const bundleScript = fs.readFileSync(path.resolve(process.cwd(), 'scripts/bundle-mcp.js'), 'utf8');
    const builderConfig = fs.readFileSync(path.resolve(process.cwd(), 'electron-builder.yml'), 'utf8');

    expect(bundleScript).toMatch(/name:\s*'building-code-server'/);
    expect(bundleScript).not.toContain('docling_bridge.py');
    expect(builderConfig).toContain('.bundle-resources/mcp');
    expect(builderConfig).toMatch(/to:\s*mcp/);
  });
});
