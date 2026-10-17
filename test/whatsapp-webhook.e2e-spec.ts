import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareDatabase, resetDatabase, startTestApp } from './support/e2e.js';
import { FakeMetaServer } from './support/fake-meta.js';

const credentials = {
  phoneNumberId: '106540352242922',
  businessAccountId: '102290129340398',
  displayPhoneNumber: '55 1234 0000',
  accessToken: 'EAAGm0PX4ZCpsBAKZB1234567890abcdefghij',
  appSecret: '0123456789abcdef0123456789abcdef',
};
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)]);

type Receipt = { source: string; status: string; sender: { phone: string; label: string } };

describe('WhatsApp webhook (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: pg.Pool;
  let meta: FakeMetaServer;
  let storageDir: string;
  let ana: string;
  let channelId: string;

  const call = (token: string, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  const notification = (messages: object[], phoneNumberId = credentials.phoneNumberId) =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: credentials.businessAccountId,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '525512340000', phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: 'Juan' }, wa_id: '5215512345678' }],
                messages,
              },
            },
          ],
        },
      ],
    });

  const sign = (body: string, secret = credentials.appSecret) =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  const deliver = (body: string, signature: string | null = sign(body)) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/whatsapp/${channelId}`,
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'x-hub-signature-256': signature } : {}),
      },
      payload: body,
    });

  const message = (id: string, from: string, extra: object) => ({
    id,
    from,
    timestamp: '1760000000',
    ...extra,
  });

  beforeAll(async () => {
    owner = await prepareDatabase();
    meta = new FakeMetaServer(credentials.accessToken);
    storageDir = mkdtempSync(join(tmpdir(), 'ticbo-objects-'));
    app = await startTestApp({
      WHATSAPP_GRAPH_URL: await meta.start(),
      OBJECT_STORAGE_DIR: storageDir,
    });
  });

  afterAll(async () => {
    await app.close();
    await meta.stop();
    await owner.end();
    rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    meta.calls.length = 0;
    meta.addMedia('media-1', PHOTO);

    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'ana@example.com', password: 'correct horse battery', fullName: 'Ana' },
    });
    ana = registered.json<{ accessToken: string }>().accessToken;
    await call(ana, 'POST', '/fiscal-profiles', {
      rfc: 'GAS1902148K3',
      legalName: 'Grupo Andina',
      taxRegime: '601',
      postalCode: '06600',
      defaultCfdiUse: 'G03',
    });
    channelId = (await call(ana, 'POST', '/whatsapp/channels', credentials)).json<{ id: string }>()
      .id;
    await call(ana, 'POST', `/whatsapp/channels/${channelId}/senders`, {
      waId: '55 1234 5678',
      label: 'Juan',
    });
  });

  it('refuses notifications without a valid signature over the exact bytes', async () => {
    const body = notification([
      message('wamid.1', '5215512345678', { type: 'text', text: { body: 'hola' } }),
    ]);

    expect((await deliver(body, null)).statusCode).toBe(403);
    expect((await deliver(body, sign(body, 'f'.repeat(32)))).statusCode).toBe(403);
    expect((await deliver(body.replace('hola', 'adiós'), sign(body))).statusCode).toBe(403);

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/whatsapp/0199f0c4-6c5e-7a10-8f00-000000000000',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
      payload: body,
    });
    expect(unknown.statusCode).toBe(404);
    expect(meta.sentTexts()).toEqual([]);
  });

  it('turns a photo from an authorized phone into a receipt, once per message', async () => {
    // WhatsApp reports this Mexican mobile with the old 1; it was authorized without it.
    const body = notification([
      message('wamid.photo', '5215512345678', { type: 'image', image: { id: 'media-1' } }),
    ]);

    expect((await deliver(body)).statusCode).toBe(200);
    expect((await deliver(body)).statusCode).toBe(200);

    expect(meta.sentTexts()).toEqual([
      {
        to: '525512345678',
        text: '✅ Recibí tu ticket. Lo voy a facturar a GRUPO ANDINA (GAS1902148K3). Te aviso por aquí cuando tenga la factura.',
      },
    ]);
    const { items } = (await call(ana, 'GET', '/receipts')).json<{ items: Receipt[] }>();
    expect(items).toEqual([
      expect.objectContaining({
        source: 'whatsapp',
        status: 'received',
        sender: { phone: '525512345678', label: 'Juan' },
      }),
    ]);
  });

  it('answers strangers, texts and files it cannot read without creating receipts', async () => {
    await deliver(
      notification([
        message('wamid.a', '5219998887777', { type: 'image', image: { id: 'media-1' } }),
        message('wamid.b', '5215512345678', { type: 'text', text: { body: 'hola' } }),
        message('wamid.c', '5215512345678', {
          type: 'document',
          document: { id: 'doc-1', mime_type: 'application/pdf' },
        }),
      ]),
    );

    expect(meta.sentTexts()).toEqual([
      { to: '529998887777', text: expect.stringContaining('no está autorizado') },
      { to: '525512345678', text: expect.stringContaining('Mándame una foto') },
      { to: '525512345678', text: expect.stringContaining('solo leo fotos') },
    ]);
    expect((await owner.query('select 1 from receipts')).rowCount).toBe(0);
  });

  it('ignores delivery statuses and messages for other numbers', async () => {
    const statuses = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: credentials.phoneNumberId },
                statuses: [{ id: 'wamid.out', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    });
    const otherNumber = notification(
      [message('wamid.x', '5215512345678', { type: 'image', image: { id: 'media-1' } })],
      '999999999999',
    );

    expect((await deliver(statuses)).statusCode).toBe(200);
    expect((await deliver(otherNumber)).statusCode).toBe(200);
    expect(meta.calls).toEqual([]);
  });
});
