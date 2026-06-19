import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeBaseDocumentRecord } from '../../../shared/ipc-types';

interface DocumentRegistryFile {
  version: 1;
  documents: KnowledgeBaseDocumentRecord[];
}

const supportedVersion = 1;
const malformedDocumentsMessage = 'Malformed knowledge-base document registry documents';

export class DocumentRegistry {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly registryPath: string) {}

  async list(): Promise<KnowledgeBaseDocumentRecord[]> {
    return (await this.read()).documents;
  }

  async get(documentId: string): Promise<KnowledgeBaseDocumentRecord | undefined> {
    return (await this.read()).documents.find((document) => document.documentId === documentId);
  }

  async upsert(record: KnowledgeBaseDocumentRecord): Promise<void> {
    await this.enqueueWrite(async () => {
      const registry = await this.read();
      const existingIndex = registry.documents.findIndex(
        (document) => document.documentId === record.documentId
      );

      if (existingIndex === -1) {
        registry.documents.push(record);
      } else {
        registry.documents[existingIndex] = record;
      }

      await this.write(registry.documents);
    });
  }

  async markRemoved(documentId: string, nowIso: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const registry = await this.read();
      const existingIndex = registry.documents.findIndex((document) => document.documentId === documentId);

      if (existingIndex === -1) {
        return;
      }

      registry.documents[existingIndex] = {
        ...registry.documents[existingIndex],
        status: 'removed',
        lastIndexRebuildAt: nowIso,
        failureMessage: null,
      };

      await this.write(registry.documents);
    });
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async read(): Promise<DocumentRegistryFile> {
    try {
      const registry = JSON.parse(await fs.readFile(this.registryPath, 'utf8')) as Partial<DocumentRegistryFile>;

      if (registry.version !== supportedVersion) {
        throw new Error('Unsupported knowledge-base document registry version');
      }

      if (!Array.isArray(registry.documents)) {
        throw new Error(malformedDocumentsMessage);
      }

      return {
        version: supportedVersion,
        documents: registry.documents,
      };
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { version: supportedVersion, documents: [] };
      }

      throw error;
    }
  }

  private async write(documents: KnowledgeBaseDocumentRecord[]): Promise<void> {
    const directory = path.dirname(this.registryPath);
    const tempPath = path.join(directory, `.${path.basename(this.registryPath)}.${randomUUID()}.tmp`);
    let renamed = false;

    await fs.mkdir(directory, { recursive: true });

    try {
      await fs.writeFile(tempPath, `${JSON.stringify({ version: supportedVersion, documents }, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, this.registryPath);
      renamed = true;
    } finally {
      if (!renamed) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
      }
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
