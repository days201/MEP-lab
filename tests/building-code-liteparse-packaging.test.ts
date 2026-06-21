import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

describe('LiteParse packaging smoke check', () => {
  it('can resolve the Node package and bundled lit CLI entry', () => {
    const require = createRequire(__filename);
    const packageJsonPath = require.resolve('@llamaindex/liteparse/package.json');
    const packageRoot = path.dirname(packageJsonPath);
    const packageJson = require(packageJsonPath) as {
      name: string;
      version: string;
      bin?: Record<string, string>;
    };

    expect(packageJson.name).toBe('@llamaindex/liteparse');
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
    const cliBinTarget = packageJson.bin?.lit ?? packageJson.bin?.liteparse;
    expect(cliBinTarget).toEqual(expect.any(String));

    const cliBinPath = path.resolve(packageRoot, cliBinTarget as string);
    expect(fs.existsSync(cliBinPath)).toBe(true);
  });
});
