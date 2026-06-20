import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSupportedKnowledgeBaseFile,
  buildKnowledgeBaseStoragePaths,
  checksumFile,
  createKnowledgeBaseSourceUri,
  detectKnowledgeBaseFileType,
} from '../src/main/mcp/building-code/storage';

const tempRoots: string[] = [];

describe('building-code knowledge-base storage', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('derives the app-owned building-code storage layout', () => {
    const paths = buildKnowledgeBaseStoragePaths('C:/Users/A/AppData/Roaming/MEP Lab');
    expect(paths.root.replaceAll('\\', '/')).toMatch(/knowledge-base\/building-code$/);
    expect(paths.registryPath.replaceAll('\\', '/')).toMatch(/documents\.json$/);
    expect(paths.sourcesDir.replaceAll('\\', '/')).toMatch(/sources$/);
    expect(paths.parsedDir.replaceAll('\\', '/')).toMatch(/parsed$/);
    expect(paths.indexDir.replaceAll('\\', '/')).toMatch(/index$/);
  });

  it('accepts the first-slice file extensions and rejects unsupported files', () => {
    const supportedExtensions = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'md', 'csv'];
    for (const extension of supportedExtensions) {
      const filePath = `code.${extension}`;
      expect(detectKnowledgeBaseFileType(filePath)).toBe(extension);
      expect(assertSupportedKnowledgeBaseFile(filePath)).toBe(extension);
    }
    expect(detectKnowledgeBaseFileType('code.PDF')).toBe('pdf');
    expect(assertSupportedKnowledgeBaseFile('code.PDF')).toBe('pdf');
    expect(() => assertSupportedKnowledgeBaseFile('malware.exe')).toThrow(
      'Unsupported building-code document type: .exe'
    );
  });

  it('computes stable sha256 file checksums', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-storage-'));
    tempRoots.push(root);
    const filePath = path.join(root, 'code.txt');
    fs.writeFileSync(filePath, 'Section 9.10.3.1 Fire separations\n');

    await expect(checksumFile(filePath)).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(checksumFile(filePath)).resolves.toBe(await checksumFile(filePath));
  });

  it('creates app-internal source URIs without leaking absolute paths', () => {
    expect(createKnowledgeBaseSourceUri('doc-123', 'source.pdf')).toBe(
      'kb://building-code/doc-123/source.pdf'
    );
  });
});
