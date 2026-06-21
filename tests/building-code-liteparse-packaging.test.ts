import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

describe('LiteParse packaging smoke check', () => {
  it('can resolve the Node package, construct LiteParse, and find bundled native assets', async () => {
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

    const liteparseModule = await import('@llamaindex/liteparse');
    const LiteParse = liteparseModule.LiteParse ?? liteparseModule.default;
    const parser = new LiteParse({ outputFormat: 'json', quiet: true, ocrEnabled: false });
    expect(parser.getConfig()).toMatchObject({
      outputFormat: 'json',
      quiet: true,
      ocrEnabled: false,
    });

    if (process.platform === 'win32' && process.arch === 'x64') {
      const nativePackageJsonPath =
        require.resolve('@llamaindex/liteparse-win32-x64-msvc/package.json');
      const nativePackageRoot = path.dirname(nativePackageJsonPath);
      expect(fs.existsSync(path.join(nativePackageRoot, 'liteparse.win32-x64-msvc.node'))).toBe(
        true
      );
    }
  });
});
