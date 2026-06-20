import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('windows legacy uninstall remediation', () => {
  it('uses a custom NSIS include with actionable recovery guidance', () => {
    const builderConfig = fs.readFileSync(path.resolve(process.cwd(), 'electron-builder.yml'), 'utf8');
    const installerInclude = fs.readFileSync(path.resolve(process.cwd(), 'resources/installer.nsh'), 'utf8');

    expect(builderConfig).toContain('include: installer.nsh');
    expect(installerInclude).toContain('!macro customUnInstallCheck');
    expect(installerInclude).toContain('Open-Cowork-Legacy-Cleanup.cmd');
    expect(installerInclude).toContain('$LOCALAPPDATA\\Programs\\Open Cowork');
  });

  it('keeps Windows installer and cleanup user-facing copy branded as MEP Lab', () => {
    const installerInclude = fs.readFileSync(path.resolve(process.cwd(), 'resources/installer.nsh'), 'utf8');
    const cleanupScript = fs.readFileSync(
      path.resolve(process.cwd(), 'resources/windows/Open-Cowork-Legacy-Cleanup.ps1'),
      'utf8'
    );

    expect(installerInclude).toContain('taskkill /T /F /IM "MEP Lab.exe"');
    expect(installerInclude).toContain("$$_.ExecutablePath -like ''*MEP Lab*''");
    expect(installerInclude).toContain('MEP Lab could not remove the previously installed legacy Open Cowork version.');
    expect(installerInclude).toContain('Close all MEP Lab and legacy Open Cowork windows.');
    expect(installerInclude).toContain('Start the MEP Lab installer again.');
    expect(installerInclude).toContain('$LOCALAPPDATA\\Programs\\Open Cowork');

    expect(cleanupScript).toContain('[MEP Lab Cleanup]');
    expect(cleanupScript).toContain('This tool removes broken legacy Open Cowork Windows install leftovers for MEP Lab.');
    expect(cleanupScript).toContain('Cleanup finished. You can rerun the MEP Lab installer now.');
    expect(cleanupScript).toContain('DisplayName -like "Open Cowork*"');
    expect(cleanupScript).toContain('Open Cowork.exe');
    expect(cleanupScript).toContain('Programs\\Open Cowork');
    expect(cleanupScript).not.toContain('rerun the Open Cowork installer');
    expect(cleanupScript).not.toMatch(/\$pathValue:/);
  });

  it('closes long-lived resources during quit cleanup', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/main/index.ts'), 'utf8');

    expect(source).toContain('closeDatabase();');
    expect(source).toContain('closeLogFile();');
    expect(source).toContain('stopNavServer();');
    expect(source).toContain("await withTimeout(remoteManager.stop(), 5000, 'Remote control shutdown');");
    expect(source).toContain("await withTimeout(mcpManager.shutdown(), 5000, 'MCP shutdown');");
  });
});
