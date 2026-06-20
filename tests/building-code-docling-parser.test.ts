import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDoclingSpawnEnv,
  DoclingParserUnavailableError,
  parseDocumentWithDocling,
  resolveDefaultBridgePath,
  type DoclingProcessRunner,
} from '../src/main/mcp/building-code/docling-parser';

const bridgeSourcePath = path.resolve(
  __dirname,
  '../src/main/mcp/building-code/docling_bridge.py'
);

describe('building-code Docling parser bridge', () => {
  it('normalizes bridge JSON from stdout', async () => {
    const runProcess: DoclingProcessRunner = async (command, args) => {
      expect(command).toBe('python');
      expect(args.at(-1)).toBe('C:\\codes\\ashrae-15.pdf');

      return {
        exitCode: 0,
        stdout: JSON.stringify({
          parserName: 'docling',
          parserVersion: '2.0.0',
          pages: [{ pageNumber: 1, text: 'Section 7 Refrigerant Safety' }],
          elements: [
            {
              elementId: 'element-1',
              kind: 'heading',
              text: 'Section 7 Refrigerant Safety',
              pageNumber: 1,
              level: 1,
              confidence: 0.98,
              bbox: { x: 10, y: 20, width: 200, height: 30 },
            },
          ],
          tables: [
            {
              elementId: 'table-1',
              caption: 'Table 7.3.1 Refrigerant limits',
              pageNumber: 2,
              columns: ['Refrigerant', 'Limit'],
              rows: [['R-32', '0.30 kg/m3']],
              notes: ['Use the lowest applicable limit.'],
              confidence: 0.91,
            },
          ],
          diagnostics: ['converted with local Docling'],
        }),
        stderr: '',
      };
    };

    await expect(
      parseDocumentWithDocling({
        filePath: 'C:\\codes\\ashrae-15.pdf',
        pythonPath: 'python',
        runProcess,
      })
    ).resolves.toEqual({
      parserName: 'docling',
      parserVersion: '2.0.0',
      pages: [
        {
          pageNumber: 1,
          text: 'Section 7 Refrigerant Safety',
          extractionMode: 'native',
          boundingBoxes: [],
        },
      ],
      elements: [
        {
          elementId: 'element-1',
          kind: 'heading',
          text: 'Section 7 Refrigerant Safety',
          pageNumber: 1,
          level: 1,
          confidence: 0.98,
          bbox: { x: 10, y: 20, width: 200, height: 30 },
          sourceIds: ['element-1'],
        },
      ],
      tables: [
        {
          elementId: 'table-1',
          caption: 'Table 7.3.1 Refrigerant limits',
          pageNumber: 2,
          columns: ['Refrigerant', 'Limit'],
          rows: [['R-32', '0.30 kg/m3']],
          notes: ['Use the lowest applicable limit.'],
          confidence: 0.91,
          sourceIds: ['table-1'],
        },
      ],
      diagnostics: ['converted with local Docling'],
      pageDiagnostics: [
        {
          pageNumber: 1,
          extractionMode: 'native',
          severity: 'info',
          message: 'Docling native extraction accepted',
          reasons: [],
        },
      ],
    });
  });

  it('rejects missing Docling runtime imports with an actionable error', async () => {
    const runProcess: DoclingProcessRunner = async () => ({
      exitCode: 1,
      stdout: '',
      stderr: [
        'Traceback (most recent call last):',
        '  File "docling_bridge.py", line 12, in <module>',
        "ModuleNotFoundError: No module named 'docling'",
      ].join('\n'),
    });

    await expect(
      parseDocumentWithDocling({
        filePath: 'C:\\codes\\ashrae-15.pdf',
        pythonPath: 'python',
        runProcess,
      })
    ).rejects.toThrow(DoclingParserUnavailableError);
  });

  it('uses the bundled bridge path shape when bridgePath is omitted', async () => {
    const runProcess: DoclingProcessRunner = async (command, args) => {
      expect(command).toBe('py');
      expect(args[0].replace(/\\/g, '/')).toMatch(/building-code\/docling_bridge\.py$/);
      expect(args[0].replace(/\\/g, '/')).not.toContain(
        'building-code/building-code/docling_bridge.py'
      );
      expect(args[1]).toBe('C:\\codes\\ashrae-34.pdf');

      return {
        exitCode: 0,
        stdout: JSON.stringify({
          parserName: 'docling',
          parserVersion: '2.0.0',
          pages: [],
          elements: [],
          tables: [],
          diagnostics: [],
        }),
        stderr: '',
      };
    };

    await parseDocumentWithDocling({
      filePath: 'C:\\codes\\ashrae-34.pdf',
      pythonPath: 'py',
      runProcess,
    });
  });

  it('keeps a bundled staged bridge path candidate for packaged MCP runtime', () => {
    const parserSource = fs.readFileSync(
      path.resolve(__dirname, '../src/main/mcp/building-code/docling-parser.ts'),
      'utf8'
    );

    expect(parserSource).toContain("path.join(__dirname, 'building-code', 'docling_bridge.py')");
    expect(parserSource).toContain("path.join(resourcesPath, 'mcp', 'building-code', 'docling_bridge.py')");
  });

  it('prefers the packaged resources bridge path when present', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docling-bridge-'));
    const bridgePath = path.join(tempRoot, 'mcp', 'building-code', 'docling_bridge.py');
    fs.mkdirSync(path.dirname(bridgePath), { recursive: true });
    fs.writeFileSync(bridgePath, '# packaged bridge\n');

    expect(resolveDefaultBridgePath(tempRoot).replace(/\\/g, '/')).toBe(
      bridgePath.replace(/\\/g, '/')
    );

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('adds bundled site-packages to PYTHONPATH for packaged Python executables', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docling-python-'));
    const sitePackages = path.join(tempRoot, 'site-packages');
    fs.mkdirSync(sitePackages, { recursive: true });
    const pythonPath = path.join(tempRoot, 'python.exe');

    const env = buildDoclingSpawnEnv(pythonPath, { EXISTING: '1' });

    expect(env.PYTHONHOME).toBe(tempRoot);
    expect(env.PYTHONNOUSERSITE).toBe('1');
    expect(env.PYTHONPATH?.split(path.delimiter)).toContain(sitePackages);
    expect(env.EXISTING).toBe('1');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('rejects raw missing module output with an actionable error', async () => {
    const runProcess: DoclingProcessRunner = async () => ({
      exitCode: 2,
      stdout: '',
      stderr: 'No module named docling',
    });

    await expect(
      parseDocumentWithDocling({
        filePath: 'C:\\codes\\ashrae-15.pdf',
        pythonPath: 'python',
        runProcess,
      })
    ).rejects.toThrow(DoclingParserUnavailableError);
  });

  it('rejects generic import failures with an actionable error', async () => {
    const runProcess: DoclingProcessRunner = async () => ({
      exitCode: 2,
      stdout: '',
      stderr: 'ImportError: cannot import name DocumentConverter from docling.document_converter',
    });

    await expect(
      parseDocumentWithDocling({
        filePath: 'C:\\codes\\ashrae-15.pdf',
        pythonPath: 'python',
        runProcess,
      })
    ).rejects.toThrow(DoclingParserUnavailableError);
  });

  it('does not classify unrelated missing modules as Docling unavailable', async () => {
    const runProcess: DoclingProcessRunner = async () => ({
      exitCode: 2,
      stdout: '',
      stderr: "ModuleNotFoundError: No module named 'pandas'",
    });

    await expect(
      parseDocumentWithDocling({
        filePath: 'C:\\codes\\ashrae-15.pdf',
        pythonPath: 'python',
        runProcess,
      })
    ).rejects.toThrow("Docling parser failed: ModuleNotFoundError: No module named 'pandas'");
  });

  it('rejects successful bridge output with an invalid result shape', async () => {
    const runProcess: DoclingProcessRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ error: 'boom' }),
      stderr: '',
    });

    await expect(
      parseDocumentWithDocling({
        filePath: 'C:\\codes\\ashrae-15.pdf',
        pythonPath: 'python',
        runProcess,
      })
    ).rejects.toThrow('Docling parser returned invalid result: parserName must be docling');
  });

  it('rejects malformed page items from successful bridge output', async () => {
    const runProcess: DoclingProcessRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        parserName: 'docling',
        parserVersion: '2.0.0',
        pages: [{}],
        elements: [],
        tables: [],
        diagnostics: [],
      }),
      stderr: '',
    });

    await expect(
      parseDocumentWithDocling({
        filePath: 'C:\\codes\\ashrae-15.pdf',
        pythonPath: 'python',
        runProcess,
      })
    ).rejects.toThrow('Docling parser returned invalid result: pages[0].pageNumber must be finite');
  });

  it('rejects malformed element items from successful bridge output', async () => {
    const runProcess: DoclingProcessRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        parserName: 'docling',
        parserVersion: '2.0.0',
        pages: [],
        elements: [{ elementId: 'x', kind: 'heading' }],
        tables: [],
        diagnostics: [],
      }),
      stderr: '',
    });

    await expect(
      parseDocumentWithDocling({
        filePath: 'C:\\codes\\ashrae-15.pdf',
        pythonPath: 'python',
        runProcess,
      })
    ).rejects.toThrow('Docling parser returned invalid result: elements[0].text must be a string');
  });

  it('rejects malformed table items from successful bridge output', async () => {
    const runProcess: DoclingProcessRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        parserName: 'docling',
        parserVersion: '2.0.0',
        pages: [],
        elements: [],
        tables: [{ elementId: 't1', caption: 'Table' }],
        diagnostics: [],
      }),
      stderr: '',
    });

    await expect(
      parseDocumentWithDocling({
        filePath: 'C:\\codes\\ashrae-15.pdf',
        pythonPath: 'python',
        runProcess,
      })
    ).rejects.toThrow('Docling parser returned invalid result: tables[0].pageNumber must be finite');
  });

  it('passes timeoutMs to the process runner', async () => {
    const runProcess: DoclingProcessRunner = async (_command, _args, options) => {
      expect(options?.timeoutMs).toBe(1234);

      return {
        exitCode: 0,
        stdout: JSON.stringify({
          parserName: 'docling',
          parserVersion: '2.0.0',
          pages: [],
          elements: [],
          tables: [],
          diagnostics: [],
        }),
        stderr: '',
      };
    };

    await parseDocumentWithDocling({
      filePath: 'C:\\codes\\ashrae-15.pdf',
      pythonPath: 'python',
      timeoutMs: 1234,
      runProcess,
    });
  });

  it('keeps the Python bridge local-only and offline by construction', () => {
    const bridgeSource = fs.readFileSync(bridgeSourcePath, 'utf8');

    expect(bridgeSource).toContain('HF_HUB_OFFLINE');
    expect(bridgeSource).toContain('TRANSFORMERS_OFFLINE');
    expect(bridgeSource).toMatch(/https?\:\/\//);
    expect(bridgeSource).toContain('Path(args.document_path).is_file()');
  });
});
