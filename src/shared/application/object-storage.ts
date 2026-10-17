import { AppError } from '../domain/app-error.js';

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

/**
 * Private file storage for ticket photos and CFDI files (Amazon S3 in
 * production, a folder in development). Keys are scoped by account:
 * `accounts/<account_id>/...`.
 */
export abstract class ObjectStorage {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;

  /** Null when there is no object with that key. */
  abstract get(key: string): Promise<StoredObject | null>;

  abstract delete(key: string): Promise<void>;
}

/** No storage is configured (production without OBJECT_STORAGE_BUCKET). */
export class StorageNotConfiguredError extends AppError {
  override readonly code = 'storage_not_configured';
  override readonly category = 'unavailable';

  constructor() {
    super('File storage is not configured.');
  }
}

/** The storage service failed or did not answer in time. */
export class StorageUnavailableError extends AppError {
  override readonly code = 'storage_unavailable';
  override readonly category = 'unavailable';

  constructor(options?: ErrorOptions) {
    super('File storage did not answer. Try again in a few minutes.', options);
  }
}
