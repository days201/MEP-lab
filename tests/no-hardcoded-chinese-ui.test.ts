import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const HAN_PATTERN = /[\u3400-\u9fff]/;

const SCANNED_PATHS = [
  'src/renderer/components',
  'src/renderer/hooks',
  'src/renderer/i18n/config.ts',
  'src/shared/api-model-presets.ts',
  'src/shared/schedule/task-title.ts',
  'src/main/claude/agent-runner-message-end.ts',
  'src/main/config/config-store.ts',
  'src/main/index.ts',
  'src/main/mcp/mcp-manager.ts',
  'src/main/remote/gateway.ts',
  'src/main/remote/message-router.ts',
  'src/main/remote/remote-manager.ts',
  'src/main/tools/sandbox-tool-executor.ts',
  'src/main/tools/tool-executor.ts',
];

const IGNORED_FILES = new Set([
  path.normalize('src/renderer/i18n/locales/zh.json'),
]);

function collectFiles(target: string): string[] {
  const absolute = path.resolve(ROOT, target);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];

  const files: string[] = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const entryPath = path.join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path.relative(ROOT, entryPath)));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('English UI guard', () => {
  it('does not ship hardcoded Chinese strings in visible UI/runtime surfaces', () => {
    const offenders = SCANNED_PATHS.flatMap(collectFiles)
      .filter((file) => !IGNORED_FILES.has(path.normalize(path.relative(ROOT, file))))
      .flatMap((file) => {
        const source = stripComments(fs.readFileSync(file, 'utf8'));
        return source
          .split(/\r?\n/)
          .map((line, index) => ({ file, line, lineNumber: index + 1 }))
          .filter(({ line }) => HAN_PATTERN.test(line));
      })
      .map(({ file, line, lineNumber }) => {
        const relative = path.relative(ROOT, file).replace(/\\/g, '/');
        return `${relative}:${lineNumber}: ${line.trim()}`;
      });

    expect(offenders).toEqual([]);
  });
});
