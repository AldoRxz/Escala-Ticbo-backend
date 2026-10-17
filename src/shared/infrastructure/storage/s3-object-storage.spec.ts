import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageUnavailableError } from '../../application/object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

/** Just enough of S3 to keep objects in memory and record the signed headers. */
function fakeS3() {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const requests: { method: string; path: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = decodeURIComponent(request.url ?? '');
      requests.push({ method: request.method ?? '', path, headers: request.headers });
      const object = objects.get(path);
      if (request.method === 'PUT') {
        objects.set(path, {
          body: Buffer.concat(chunks),
          type: request.headers['content-type'] ?? '',
        });
        response.writeHead(200).end();
      } else if (request.method === 'GET' && object) {
        response.writeHead(200, { 'content-type': object.type }).end(object.body);
      } else if (request.method === 'DELETE') {
        objects.delete(path);
        response.writeHead(204).end();
      } else {
        response.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
      }
    });
  });
  return { server, objects, requests };
}

describe('S3ObjectStorage', () => {
  const s3 = fakeS3();
  let endpoint: string;
  const credentials = {
    accessKeyId: 'ASIATESTKEY',
    secretAccessKey: 'test-secret',
    sessionToken: 'session-token',
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => s3.server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(s3.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (s3.server as Server).close(() => resolve()));
  });

  it('puts, gets and deletes objects with SigV4 and the role session token', async () => {
    const storage = new S3ObjectStorage(
      { bucket: 'ticbo-files', region: 'us-west-2', endpoint },
      () => credentials,
    );
    const photo = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);

    await storage.put('accounts/acc-1/receipts/r 1.jpg', photo, 'image/jpeg');
    expect(await storage.get('accounts/acc-1/receipts/r 1.jpg')).toEqual({
      body: photo,
      contentType: 'image/jpeg',
    });
    await storage.delete('accounts/acc-1/receipts/r 1.jpg');
    expect(await storage.get('accounts/acc-1/receipts/r 1.jpg')).toBeNull();

    const [put] = s3.requests;
    expect(put?.path).toBe('/ticbo-files/accounts/acc-1/receipts/r 1.jpg');
    expect(put?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=ASIATESTKEY\/\d{8}\/us-west-2\/s3\/aws4_request, /,
    );
    expect(put?.headers['x-amz-security-token']).toBe('session-token');
  });

  it('fails as unavailable without credentials or when S3 refuses', async () => {
    const anonymous = new S3ObjectStorage(
      { bucket: 'ticbo-files', region: 'us-west-2', endpoint },
      () => null,
    );
    await expect(anonymous.put('a.jpg', Buffer.from('x'), 'image/jpeg')).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );

    const unreachable = new S3ObjectStorage(
      { bucket: 'ticbo-files', region: 'us-west-2', endpoint: 'http://127.0.0.1:9' },
      () => credentials,
    );
    await expect(unreachable.get('a.jpg')).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});
