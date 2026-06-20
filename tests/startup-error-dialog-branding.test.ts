import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('startup error dialog branding', () => {
  it('uses English MEP Lab copy in the fatal startup dialog', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/main/index.ts'), 'utf8');

    expect(source).toContain("dialog.showErrorBox('MEP Lab Startup Failed'");
    expect(source).toContain('Check the logs for more information.');
    expect(source).not.toContain("dialog.showErrorBox('MEP Lab 启动失败'");
    expect(source).not.toContain('请查看日志获取更多信息。');
  });
});
