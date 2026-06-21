import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');

describe('dark theme palette', () => {
  it('uses a Zinc & Indigo palette for the default theme', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-background: #09090b;');
    expect(source).toContain('--color-surface: #18181b;');
    expect(source).toContain('--color-text-primary: #fafafa;');
  });

  it('keeps the accent within the Indigo family', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-accent: #6366f1;');
    expect(source).toContain('--color-accent-hover: #4f46e5;');
  });
});
