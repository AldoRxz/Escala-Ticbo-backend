import { AwsClient } from 'aws4fetch';
import {
  ObjectStorage,
  StorageUnavailableError,
  type StoredObject,
} from '../../application/object-storage.js';

export interface S3StorageSettings {
  /** https://<account>.r2.cloudflarestorage.com for R2, https://s3.<region>.amazonaws.com for S3. */
  endpoint: string;
  bucket: string;
  /** "auto" for R2. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const TIMEOUT_MS = 5_000;

/** Any S3-compatible bucket (Cloudflare R2 in production), signed with SigV4. */
export class S3ObjectStorage extends ObjectStorage {
  private readonly client: AwsClient;

  constructor(private readonly settings: S3StorageSettings) {
    super();
    this.client = new AwsClient({
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      service: 's3',
      region: settings.region,
      // Few retries: the API Lambda has 10 s for the whole request.
      retries: 2,
      initRetryMs: 100,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.send(key, {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'content-type': contentType },
    });
    if (!response.ok) {
      throw new StorageUnavailableError({ cause: new Error(`PUT answered ${response.status}`) });
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.send(key, { method: 'GET' });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new StorageUnavailableError({ cause: new Error(`GET answered ${response.status}`) });
    }
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    const response = await this.send(key, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new StorageUnavailableError({ cause: new Error(`DELETE answered ${response.status}`) });
    }
  }

  private async send(key: string, init: RequestInit): Promise<Response> {
    const url = `${this.settings.endpoint}/${this.settings.bucket}/${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    try {
      return await this.client.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
  }
}
