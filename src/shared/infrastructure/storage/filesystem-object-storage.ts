import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { ObjectStorage, type StoredObject } from '../../application/object-storage.js';

/** Development storage: objects are files under one folder, typed by their extension. */
export class FilesystemObjectStorage extends ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    super();
    this.root = resolve(root);
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      return { body: await readFile(this.pathOf(key)), contentType: contentTypeOf(key) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  private pathOf(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) {
      throw new Error(`Object key escapes the storage folder: ${key}`);
    }
    return path;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  xml: 'application/xml',
};

function contentTypeOf(key: string): string {
  return CONTENT_TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
