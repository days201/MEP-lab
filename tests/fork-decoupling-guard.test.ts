import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkForkDecoupling } = require('../scripts/check-fork-decoupling.js') as {
  checkForkDecoupling: (rootDir: string) => {
    violations: Array<{ area: string; message: string }>;
  };
};

describe('fork decoupling guard', () => {
  it('keeps repository metadata and remotes pointed at MEP Lab', () => {
    const result = checkForkDecoupling(path.resolve(process.cwd()));

    expect(result.violations).toEqual([]);
  });

  it('runs the decoupling guard in package scripts and GitHub automation', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    const ciWorkflow = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const releaseWorkflow = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(packageJson.scripts['check:fork-decoupling']).toBe('node scripts/check-fork-decoupling.js');
    expect(ciWorkflow).toContain('npm run check:fork-decoupling');
    expect(ciWorkflow).toContain('npm run check:branding');
    expect(releaseWorkflow).toContain('npm run check:fork-decoupling');
    expect(releaseWorkflow).toContain('npm run check:branding');
  });
});
