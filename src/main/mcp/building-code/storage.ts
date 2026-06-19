import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const acceptedKnowledgeBaseExtensions = new Set([
  '.pdf',
  '.docx',
  '.doc',
  '.xlsx',
  '.xls',
  '.txt',
  '.md',
  '.csv',
]);

export interface KnowledgeBaseStoragePaths {
  root: string;
  registryPath: string;
  sourcesDir: string;
  parsedDir: string;
  indexDir: string;
}

export function buildKnowledgeBaseStoragePaths(userDataPath: string): KnowledgeBaseStoragePaths {
  const root = path.join(userDataPath, 'knowledge-base', 'building-code');
  return {
    root,
    registryPath: path.join(root, 'documents.json'),
    sourcesDir: path.join(root, 'sources'),
    parsedDir: path.join(root, 'parsed'),
    indexDir: path.join(root, 'index'),
  };
}

export function detectKnowledgeBaseFileType(filePath: string): string {
  return path.extname(filePath).toLowerCase().replace(/^\./, '');
}

export function assertSupportedKnowledgeBaseFile(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (!acceptedKnowledgeBaseExtensions.has(extension)) {
    throw new Error(`Unsupported building-code document type: ${extension || '(none)'}`);
  }
  return extension.slice(1);
}

export async function checksumFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const file = await fs.open(filePath, 'r');
  try {
    for await (const chunk of file.createReadStream()) {
      hash.update(chunk);
    }
  } finally {
    await file.close();
  }
  return `sha256:${hash.digest('hex')}`;
}

export function createKnowledgeBaseSourceUri(documentId: string, filename: string): string {
  return `kb://building-code/${encodeURIComponent(documentId)}/${encodeURIComponent(filename)}`;
}

export async function ensureKnowledgeBaseStorage(paths: KnowledgeBaseStoragePaths): Promise<void> {
  await fs.mkdir(paths.sourcesDir, { recursive: true });
  await fs.mkdir(paths.parsedDir, { recursive: true });
  await fs.mkdir(paths.indexDir, { recursive: true });
}
