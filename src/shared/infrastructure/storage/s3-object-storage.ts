import { AwsV4Signer } from 'aws4fetch';
import {
  ObjectStorage,
  StorageUnavailableError,
  type StoredObject,
} from '../../application/object-storage.js';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

export interface S3StorageSettings {
  bucket: string;
  region: string;
  /** Path-style endpoint (`<endpoint>/<bucket>/<key>`) for a fake S3 in tests; AWS otherwise. */
  endpoint?: string;
}

/**
 * Lambda hands each execution environment its role's temporary credentials in
 * these variables (locally: `aws configure export-credentials --format env`).
 * Read on every call, so refreshed values are picked up.
 */
export function credentialsFromEnvironment(): AwsCredentials | null {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  return AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
        sessionToken: AWS_SESSION_TOKEN,
      }
    : null;
}

const TIMEOUT_MS = 5_000;

/**
 * Amazon S3 over fetch with SigV4 signing (aws4fetch): a few KB instead of the
 * AWS SDK in the Lambda bundle. The bucket is private; nothing here makes
 * objects public.
 */
export class S3ObjectStorage extends ObjectStorage {
  private readonly baseUrl: string;

  constructor(
    private readonly settings: S3StorageSettings,
    private readonly credentials: () => AwsCredentials | null = credentialsFromEnvironment,
  ) {
    super();
    this.baseUrl = settings.endpoint
      ? `${settings.endpoint.replace(/\/+$/, '')}/${settings.bucket}`
      : `https://${settings.bucket}.s3.${settings.region}.amazonaws.com`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.send('PUT', key, new Uint8Array(body), contentType);
    if (!response.ok) {
      throw new StorageUnavailableError({ cause: new Error(`PUT answered ${response.status}`) });
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.send('GET', key);
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
    const response = await this.send('DELETE', key);
    if (!response.ok && response.status !== 404) {
      throw new StorageUnavailableError({ cause: new Error(`DELETE answered ${response.status}`) });
    }
  }

  private async send(
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    const credentials = this.credentials();
    if (!credentials) {
      throw new StorageUnavailableError({
        cause: new Error('No AWS credentials in the environment'),
      });
    }
    const url = `${this.baseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
    try {
      const signed = await new AwsV4Signer({
        method,
        url,
        headers: contentType ? { 'content-type': contentType } : {},
        body: body ?? null,
        service: 's3',
        region: this.settings.region,
        ...credentials,
      }).sign();
      return await fetch(signed.url, {
        method: signed.method,
        headers: signed.headers,
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
  }
}
