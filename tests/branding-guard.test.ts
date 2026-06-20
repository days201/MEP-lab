import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkBranding } = require('../scripts/check-branding.js') as {
  checkBranding: (rootDir: string) => { violations: Array<{ file: string; term: string }> };
};

describe('branding guard', () => {
  it('rejects reintroduced upstream branding outside documented legacy exceptions', () => {
    const result = checkBranding(path.resolve(process.cwd()));

    expect(result.violations).toEqual([]);
  });
});
