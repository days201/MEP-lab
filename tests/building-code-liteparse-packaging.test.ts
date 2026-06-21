import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

describe('LiteParse packaging smoke check', () => {
  it('can resolve the Node package and bundled lit CLI entry', () => {
    const require = createRequire(__filename);
    const packageJsonPath = require.resolve('@llamaindex/liteparse/package.json');
    const packageJson = require(packageJsonPath) as {
      name: string;
      version: string;
      bin?: Record<string, string>;
    };

    expect(packageJson.name).toBe('@llamaindex/liteparse');
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(packageJson.bin?.lit || packageJson.bin?.liteparse).toBeTruthy();
  });
});
