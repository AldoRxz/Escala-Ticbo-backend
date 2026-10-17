import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareDatabase, resetDatabase, startTestApp } from './support/e2e.js';
import { FakeTelegramServer } from './support/fake-telegram.js';

const TOKEN = '7012345678:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

type Bot = {
  id: string;
  username: string;
  link: string;
  status: string;
  senders: { id: string; phone: string; label: string | null; linked: boolean }[];
};

describe('Telegram bots (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: pg.Pool;
  let telegram: FakeTelegramServer;

  async function signUp(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct horse battery', fullName: 'Prueba' },
    });
    return response.json<{ accessToken: string }>().accessToken;
  }

  const call = (
    token: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  beforeAll(async () => {
    owner = await prepareDatabase();
    telegram = new FakeTelegramServer();
    const telegramUrl = await telegram.start();
    app = await startTestApp({ TELEGRAM_API_URL: telegramUrl });
  });

  afterAll(async () => {
    await app.close();
    await telegram.stop();
    await owner.end();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    telegram.calls.length = 0;
    telegram.addBot(TOKEN, {
      id: 7012345678,
      username: 'AndinaFacturasBot',
      firstName: 'Andina Facturas',
    });
  });

  it('connects a bot with its token encrypted and registers the webhook itself', async () => {
    const token = await signUp('ana@example.com');

    const connected = await call(token, 'POST', '/telegram/bots', { token: TOKEN });
    expect(connected.statusCode).toBe(201);
    const bot = connected.json<Bot>();
    expect(bot).toMatchObject({
      username: 'AndinaFacturasBot',
      displayName: 'Andina Facturas',
      link: 'https://t.me/AndinaFacturasBot',
      status: 'active',
      senders: [],
    });

    const [webhook] = telegram.callsTo('setWebhook');
    expect(webhook?.body).toMatchObject({
      url: `http://localhost:4000/api/v1/webhooks/telegram/${bot.id}`,
      allowed_updates: ['message'],
    });
    expect(webhook?.body.secret_token).toEqual(expect.any(String));

    const { rows } = await owner.query<{ kind: string; ciphertext: Buffer }>(
      'select kind, ciphertext from encrypted_secrets',
    );
    expect(rows.map((row) => row.kind)).toEqual(['telegram_bot_token']);
    expect(rows[0]!.ciphertext.includes(Buffer.from(TOKEN))).toBe(false);
    const list = await call(token, 'GET', '/telegram/bots');
    expect(list.body).not.toContain(TOKEN);
    expect(list.body).not.toContain(String(webhook?.body.secret_token));
    expect(list.json<{ items: Bot[] }>().items).toHaveLength(1);
  });

  it('explains a token Telegram rejects and one that is not a token', async () => {
    const token = await signUp('ana@example.com');

    const unknown = await call(token, 'POST', '/telegram/bots', {
      token: '7012345678:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDzzz',
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({
      errors: [{ path: 'token', code: 'bot_token_rejected' }],
    });

    const malformed = await call(token, 'POST', '/telegram/bots', { token: 'hola' });
    expect(malformed.json()).toMatchObject({
      errors: [{ path: 'token', code: 'invalid_bot_token' }],
    });
    expect((await owner.query('select 1 from encrypted_secrets')).rowCount).toBe(0);
  });

  it('refuses a bot already connected to another account', async () => {
    const ana = await signUp('ana@example.com');
    const beto = await signUp('beto@example.com');
    await call(ana, 'POST', '/telegram/bots', { token: TOKEN });

    const second = await call(beto, 'POST', '/telegram/bots', { token: TOKEN });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'telegram_bot_already_connected' });
    expect(telegram.callsTo('setWebhook')).toHaveLength(1);
    expect((await owner.query('select 1 from encrypted_secrets')).rowCount).toBe(1);
  });

  it('authorizes phones and keeps bots private to their account', async () => {
    const ana = await signUp('ana@example.com');
    const beto = await signUp('beto@example.com');
    const bot = (await call(ana, 'POST', '/telegram/bots', { token: TOKEN })).json<Bot>();

    const added = await call(ana, 'POST', `/telegram/bots/${bot.id}/senders`, {
      phone: '55 1234 5678',
      label: 'Juan · ventas',
    });
    expect(added.statusCode).toBe(201);
    const sender = added.json<Bot['senders'][number]>();
    expect(sender).toMatchObject({ phone: '525512345678', label: 'Juan · ventas', linked: false });

    const repeated = await call(ana, 'POST', `/telegram/bots/${bot.id}/senders`, {
      phone: '+52 55 1234 5678',
    });
    expect(repeated.statusCode).toBe(409);

    expect((await call(beto, 'GET', '/telegram/bots')).json<{ items: Bot[] }>().items).toEqual([]);
    const foreign = await call(beto, 'POST', `/telegram/bots/${bot.id}/senders`, {
      phone: '5598765432',
    });
    expect(foreign.statusCode).toBe(404);

    const renamed = await call(ana, 'PATCH', `/telegram/bots/${bot.id}/senders/${sender.id}`, {
      label: 'Juan',
    });
    expect(renamed.json()).toMatchObject({ label: 'Juan' });
    const revoked = await call(ana, 'DELETE', `/telegram/bots/${bot.id}/senders/${sender.id}`);
    expect(revoked.statusCode).toBe(204);
  });

  it('disconnects a bot: its webhook goes away and so does its token', async () => {
    const token = await signUp('ana@example.com');
    const bot = (await call(token, 'POST', '/telegram/bots', { token: TOKEN })).json<Bot>();
    await call(token, 'POST', `/telegram/bots/${bot.id}/senders`, { phone: '5512345678' });

    const removed = await call(token, 'DELETE', `/telegram/bots/${bot.id}`);
    expect(removed.statusCode).toBe(204);
    expect(telegram.callsTo('deleteWebhook')).toHaveLength(1);
    expect((await owner.query('select 1 from encrypted_secrets')).rowCount).toBe(0);
    expect((await owner.query('select 1 from telegram_senders')).rowCount).toBe(0);
    expect((await call(token, 'GET', '/telegram/bots')).json<{ items: Bot[] }>().items).toEqual([]);
  });
});
