import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareDatabase, resetDatabase, startTestApp } from './support/e2e.js';
import { FakeTelegramServer } from './support/fake-telegram.js';

const TOKEN = '7012345678:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const USER_ID = 81_234_567;
// A tiny but genuine JPEG header: the API checks the bytes, not the extension.
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

type Receipt = {
  id: string;
  source: string;
  status: string;
  receiver: { rfc: string; legalName: string } | null;
  cfdiUse: string | null;
  sender: { phone: string | null; label: string | null };
};

describe('Telegram webhook (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: pg.Pool;
  let telegram: FakeTelegramServer;
  let storageDir: string;
  let ana: string;
  let botId: string;
  let secret: string;
  let nextMessageId = 1;

  async function signUp(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct horse battery', fullName: 'Prueba' },
    });
    return response.json<{ accessToken: string }>().accessToken;
  }

  const call = (token: string, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  const deliver = (message: object, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/telegram/${botId}`,
      headers: { 'x-telegram-bot-api-secret-token': secret, ...headers },
      payload: {
        update_id: nextMessageId,
        message: {
          message_id: nextMessageId++,
          date: 1_760_000_000,
          chat: { id: USER_ID, type: 'private', first_name: 'Juan' },
          from: { id: USER_ID, is_bot: false, first_name: 'Juan' },
          ...message,
        },
      },
    });

  const replies = () =>
    telegram.callsTo('sendMessage').map((sent) => ({
      text: String(sent.body.text),
      keyboard: sent.body.reply_markup as Record<string, unknown> | undefined,
    }));

  beforeAll(async () => {
    owner = await prepareDatabase();
    telegram = new FakeTelegramServer();
    storageDir = mkdtempSync(join(tmpdir(), 'ticbo-objects-'));
    app = await startTestApp({
      TELEGRAM_API_URL: await telegram.start(),
      OBJECT_STORAGE_DIR: storageDir,
    });
  });

  afterAll(async () => {
    await app.close();
    await telegram.stop();
    await owner.end();
    rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    telegram.calls.length = 0;
    telegram.addBot(TOKEN, { id: 7012345678, username: 'AndinaBot', firstName: 'Andina' });
    telegram.addFile('photo-big', PHOTO);

    ana = await signUp('ana@example.com');
    await call(ana, 'POST', '/fiscal-profiles', {
      rfc: 'GAS1902148K3',
      legalName: 'Grupo Andina',
      taxRegime: '601',
      postalCode: '06600',
      defaultCfdiUse: 'G03',
    });
    botId = (await call(ana, 'POST', '/telegram/bots', { token: TOKEN })).json<{ id: string }>().id;
    secret = String(telegram.callsTo('setWebhook')[0]!.body.secret_token);
    await call(ana, 'POST', `/telegram/bots/${botId}/senders`, {
      phone: '55 1234 5678',
      label: 'Juan',
    });
    telegram.calls.length = 0;
  });

  it('only accepts updates that carry the bot secret', async () => {
    const forged = await deliver({ text: 'hola' }, { 'x-telegram-bot-api-secret-token': 'nope' });
    expect(forged.statusCode).toBe(403);

    const unsigned = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/telegram/${botId}`,
      payload: { update_id: 1 },
    });
    expect(unsigned.statusCode).toBe(403);

    const unknownBot = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/telegram/0199f0c4-6c5e-7a10-8f00-000000000000',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      payload: { update_id: 1 },
    });
    expect(unknownBot.statusCode).toBe(404);
    expect(replies()).toEqual([]);
  });

  it('asks a stranger to share their number before taking any ticket', async () => {
    const response = await deliver({ photo: [{ file_id: 'photo-big', file_size: PHOTO.length }] });

    expect(response.statusCode).toBe(200);
    const [reply] = replies();
    expect(reply?.text).toContain('Compartir mi número');
    expect(reply?.keyboard).toMatchObject({
      keyboard: [[{ text: '📱 Compartir mi número', request_contact: true }]],
    });
    expect((await owner.query('select 1 from receipts')).rowCount).toBe(0);
  });

  it('links a person who shares their own authorized number, in either Mexican format', async () => {
    await deliver({ contact: { phone_number: '+52 1 55 9999 0000', user_id: USER_ID } });
    await deliver({ contact: { phone_number: '5215512345678', user_id: 99 } });
    await deliver({ contact: { phone_number: '5215512345678', user_id: USER_ID } });

    expect(replies().map((reply) => reply.text)).toEqual([
      expect.stringContaining('+52 55 9999 0000 no está autorizado'),
      expect.stringContaining('tu propio número'),
      expect.stringContaining('¡Listo, Juan!'),
    ]);
    expect(replies()[2]?.keyboard).toEqual({ remove_keyboard: true });

    const [bot] = (await call(ana, 'GET', '/telegram/bots')).json<{
      items: { senders: { phone: string; linked: boolean }[] }[];
    }>().items;
    expect(bot?.senders).toEqual([
      expect.objectContaining({ phone: '525512345678', linked: true }),
    ]);
  });

  it('turns a photo from a linked person into a receipt, once per message', async () => {
    await deliver({ contact: { phone_number: '525512345678', user_id: USER_ID } });
    telegram.calls.length = 0;

    const photo = { photo: [{ file_id: 'photo-small' }, { file_id: 'photo-big' }] };
    const first = await deliver(photo);
    nextMessageId--; // Telegram retries the same update
    const retry = await deliver(photo);

    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(replies().map((reply) => reply.text)).toEqual([
      '✅ Recibí tu ticket. Lo voy a facturar a GRUPO ANDINA (GAS1902148K3). Te aviso por aquí cuando tenga la factura.',
    ]);
    expect(telegram.callsTo('getFile')[0]?.body).toEqual({ file_id: 'photo-big' });

    const { items } = (await call(ana, 'GET', '/receipts')).json<{ items: Receipt[] }>();
    expect(items).toEqual([
      expect.objectContaining({
        source: 'telegram',
        status: 'received',
        receiver: expect.objectContaining({ rfc: 'GAS1902148K3' }),
        cfdiUse: 'G03',
        sender: { phone: '525512345678', label: 'Juan' },
      }),
    ]);

    const image = await call(ana, 'GET', `/receipts/${items[0]!.id}/image`);
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.rawPayload.equals(PHOTO)).toBe(true);

    const beto = await signUp('beto@example.com');
    expect((await call(beto, 'GET', `/receipts/${items[0]!.id}/image`)).statusCode).toBe(404);
    expect((await call(beto, 'GET', '/receipts')).json<{ items: Receipt[] }>().items).toEqual([]);

    const accountDirs = readdirSync(join(storageDir, 'accounts'));
    expect(accountDirs).toHaveLength(1);
  });

  it('explains what it cannot read', async () => {
    await deliver({ contact: { phone_number: '525512345678', user_id: USER_ID } });
    telegram.addFile('svg-file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    telegram.calls.length = 0;

    await deliver({ document: { file_id: 'a-pdf', mime_type: 'application/pdf' } });
    await deliver({ document: { file_id: 'svg-file', mime_type: 'image/svg+xml' } });
    await deliver({ text: '/start' });

    expect(replies().map((reply) => reply.text)).toEqual([
      expect.stringContaining('solo leo fotos'),
      expect.stringContaining('solo leo fotos'),
      'Mándame una foto de tu ticket y yo me encargo de la factura. 📸',
    ]);
    expect((await owner.query('select 1 from receipts')).rowCount).toBe(0);
  });
});
