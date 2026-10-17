import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TelegramCall {
  token: string;
  method: string;
  body: Record<string, unknown>;
}

interface FakeBot {
  id: number;
  username: string;
  firstName: string;
}

/**
 * Telegram's Bot API on localhost: knows the bots it is given, records every
 * call and serves the files registered with `addFile`.
 */
export class FakeTelegramServer {
  readonly calls: TelegramCall[] = [];
  private readonly bots = new Map<string, FakeBot>();
  private readonly files = new Map<string, { path: string; body: Buffer }>();
  private server: Server | null = null;

  addBot(token: string, bot: FakeBot): void {
    this.bots.set(token, bot);
  }

  addFile(fileId: string, body: Buffer, path = `photos/${fileId}.jpg`): void {
    this.files.set(fileId, { path, body });
  }

  callsTo(method: string): TelegramCall[] {
    return this.calls.filter((call) => call.method === method);
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
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  private async handle(
    request: IncomingMessage,
  ): Promise<{ status: number; body: string | Buffer; type: string }> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const download = /^\/file\/bot([^/]+)\/(.+)$/.exec(url.pathname);
    if (download) {
      const file = [...this.files.values()].find((candidate) => candidate.path === download[2]);
      return file && this.bots.has(download[1]!)
        ? { status: 200, body: file.body, type: 'image/jpeg' }
        : { status: 404, body: 'Not Found', type: 'text/plain' };
    }

    const match = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    const body = chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString()) as object) : {};
    if (!match) {
      return json(404, { ok: false, error_code: 404, description: 'Not Found' });
    }
    const [, token, method] = match as unknown as [string, string, string];
    const bot = this.bots.get(token);
    if (!bot) {
      return json(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    }
    this.calls.push({ token, method, body: body as Record<string, unknown> });

    switch (method) {
      case 'getMe':
        return ok({ id: bot.id, is_bot: true, first_name: bot.firstName, username: bot.username });
      case 'getFile': {
        const fileId = (body as { file_id?: string }).file_id ?? '';
        const file = this.files.get(fileId);
        return file
          ? ok({ file_id: fileId, file_size: file.body.length, file_path: file.path })
          : json(400, { ok: false, error_code: 400, description: 'Bad Request: invalid file_id' });
      }
      default:
        return ok(true);
    }
  }
}

function json(status: number, payload: object) {
  return { status, body: JSON.stringify(payload), type: 'application/json' };
}

function ok(result: unknown) {
  return json(200, { ok: true, result });
}
