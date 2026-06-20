import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const scriptPath = path.resolve(process.cwd(), 'scripts/build-windows.js');

describe('build-windows helper', () => {
  it('exits early on non-Windows hosts to avoid misleading runs', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain("if (process.platform !== 'win32') {");
    expect(source).toContain('Skipping build.');
    expect(source).toContain('process.exit(0);');
  });

  it('copies legacy cleanup helpers into the Windows release output after a successful build', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain("const { writeLegacyCleanupArtifacts } = require('./build-windows-artifacts');");
    expect(source).toContain('writeLegacyCleanupArtifacts({');
    expect(source).toContain('Added legacy cleanup helper:');
  });

  it('packages the bundled Python runtime for Docling', () => {
    const builderConfig = fs.readFileSync(path.join(process.cwd(), 'electron-builder.yml'), 'utf8');
    const winBlock = builderConfig.match(/^win:\n(?<block>[\s\S]*?)^mac:/m)?.groups?.block;

    expect(winBlock).toMatch(/extraResources:\n[\s\S]*from: resources\/python\/win32-x64\n\s+to: python/);

    const preparePython = fs.readFileSync(path.join(process.cwd(), 'scripts/prepare-python.js'), 'utf8');
    expect(preparePython).toContain('BUNDLED_PYTHON_PACKAGES');
    expect(preparePython).toContain("'docling'");
    expect(preparePython).toContain('win32:');
    expect(preparePython).toContain('x86_64-pc-windows-msvc');
    expect(preparePython).not.toContain('Unsupported platform, skipping');
  });
});
