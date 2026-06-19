import { describe, expect, it } from 'vitest';
import {
  DoclingParserUnavailableError,
  parseDocumentWithDocling,
  type DoclingProcessRunner,
} from '../src/main/mcp/building-code/docling-parser';

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
      stderr: 'ImportError: cannot import name DocumentConverter',
    });

    await expect(
      parseDocumentWithDocling({
        filePath: 'C:\\codes\\ashrae-15.pdf',
        pythonPath: 'python',
        runProcess,
      })
    ).rejects.toThrow(DoclingParserUnavailableError);
  });
});
