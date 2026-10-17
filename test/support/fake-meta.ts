import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface GraphCall {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

/**
 * Meta's Graph API on localhost, for the WhatsApp webhook: media lookups,
 * media downloads (bearer token required) and outgoing messages.
 */
export class FakeMetaServer {
  readonly calls: GraphCall[] = [];
  private readonly media = new Map<string, Buffer>();
  private server: Server | null = null;
  private base = '';

  constructor(private readonly accessToken: string) {}

  addMedia(id: string, body: Buffer): void {
    this.media.set(id, body);
  }

  sentTexts(): { to: string; text: string }[] {
    return this.calls
      .filter((call) => call.method === 'POST' && call.path.endsWith('/messages'))
      .map((call) => ({
        to: String(call.body.to),
        text: String((call.body.text as { body: string }).body),
      }));
  }

  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      void this.handle(request).then(({ status, body, type }) => {
        response.writeHead(status, { 'content-type': type });
        response.end(body);
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.base = `http://127.0.0.1:${port}`;
    return this.base;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  private async handle(
    request: IncomingMessage,
  ): Promise<{ status: number; body: string | Buffer; type: string }> {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    const body =
      chunks.length > 0
        ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>)
        : {};
    if (request.headers.authorization !== `Bearer ${this.accessToken}`) {
      return json(401, { error: { message: 'Invalid OAuth access token.', code: 190 } });
    }
    this.calls.push({ method: request.method ?? 'GET', path, body });

    const download = /^\/media\/(.+)$/.exec(path);
    if (download) {
      const file = this.media.get(download[1]!);
      return file
        ? { status: 200, body: file, type: 'image/jpeg' }
        : json(404, { error: { message: 'Not found' } });
    }
    const lookup = /^\/v\d+\.\d+\/([^/]+)$/.exec(path);
    if (lookup && request.method === 'GET') {
      const file = this.media.get(lookup[1]!);
      return file
        ? json(200, {
            url: `${this.base}/media/${lookup[1]}`,
            mime_type: 'image/jpeg',
            file_size: file.length,
            id: lookup[1],
          })
        : json(400, { error: { message: 'Unsupported get request.', code: 100 } });
    }
    if (/^\/v\d+\.\d+\/[^/]+\/messages$/.test(path)) {
      return json(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.out' }] });
    }
    return json(404, { error: { message: 'Unknown path' } });
  }
}

function json(status: number, payload: object) {
  return { status, body: JSON.stringify(payload), type: 'application/json' };
}
