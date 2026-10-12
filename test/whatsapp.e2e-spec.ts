import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareDatabase, resetDatabase, startTestApp } from './support/e2e.js';

const credentials = {
  phoneNumberId: '106540352242922',
  businessAccountId: '102290129340398',
  displayPhoneNumber: '55 1234 5678',
  accessToken: 'EAAGm0PX4ZCpsBAKZB1234567890abcdefghij',
  appSecret: '0123456789abcdef0123456789abcdef',
};

const andina = {
  rfc: 'GAS1902148K3',
  legalName: 'Grupo Andina',
  taxRegime: '601',
  postalCode: '06600',
  defaultCfdiUse: 'G03',
};

type Channel = {
  id: string;
  status: string;
  webhookUrl: string;
  verifyToken?: string;
  senders: { id: string; waId: string; label: string | null }[];
};

describe('WhatsApp channels (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: pg.Pool;

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

  const verifyWebhook = (channelId: string, token: string, challenge = '1158201444') =>
    app.inject({
      method: 'GET',
      url: `/api/v1/webhooks/whatsapp/${channelId}`,
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': challenge },
    });

  beforeAll(async () => {
    owner = await prepareDatabase();
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
    await owner.end();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
  });

  it('connects a number keeping its credentials encrypted and never returning them', async () => {
    const token = await signUp('ana@example.com');

    const connected = await call(token, 'POST', '/whatsapp/channels', credentials);
    expect(connected.statusCode).toBe(201);
    const channel = connected.json<Channel>();
    expect(channel).toMatchObject({
      displayPhoneNumber: '+525512345678',
      status: 'pending_verification',
      senders: [],
    });
    expect(channel.webhookUrl).toBe(`http://localhost:4000/api/v1/webhooks/whatsapp/${channel.id}`);
    expect(channel.verifyToken).toEqual(expect.any(String));

    const { rows } = await owner.query<{ kind: string; ciphertext: Buffer }>(
      'select kind, ciphertext from encrypted_secrets order by kind',
    );
    expect(rows.map((row) => row.kind)).toEqual(['whatsapp_access_token', 'whatsapp_app_secret']);
    for (const row of rows) {
      expect(row.ciphertext.includes(Buffer.from(credentials.accessToken))).toBe(false);
      expect(row.ciphertext.includes(Buffer.from(credentials.appSecret))).toBe(false);
    }

    const list = await call(token, 'GET', '/whatsapp/channels');
    const text = list.body;
    expect(text).not.toContain(credentials.accessToken);
    expect(text).not.toContain(credentials.appSecret);
    expect(text).not.toContain(channel.verifyToken);
    expect(list.json<{ items: Channel[] }>().items).toHaveLength(1);
  });

  it('answers the Meta verification only with the right token and activates the number', async () => {
    const token = await signUp('ana@example.com');
    const channel = (await call(token, 'POST', '/whatsapp/channels', credentials)).json<Channel>();

    const wrong = await verifyWebhook(channel.id, 'not-the-token');
    expect(wrong.statusCode).toBe(403);

    const right = await verifyWebhook(channel.id, channel.verifyToken!);
    expect(right.statusCode).toBe(200);
    expect(right.headers['content-type']).toContain('text/plain');
    expect(right.body).toBe('1158201444');

    const [listed] = (await call(token, 'GET', '/whatsapp/channels')).json<{ items: Channel[] }>()
      .items;
    expect(listed?.status).toBe('active');

    // A new verify token replaces the old one.
    const fresh = await call(token, 'POST', `/whatsapp/channels/${channel.id}/verify-token`);
    const { verifyToken } = fresh.json<{ verifyToken: string }>();
    expect((await verifyWebhook(channel.id, channel.verifyToken!)).statusCode).toBe(403);
    expect((await verifyWebhook(channel.id, verifyToken)).statusCode).toBe(200);
  });

  it('reports wrong credentials field by field', async () => {
    const token = await signUp('ana@example.com');
    const response = await call(token, 'POST', '/whatsapp/channels', {
      ...credentials,
      appSecret: 'nope',
      displayPhoneNumber: '123',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: { path: string; code: string }[] }>().errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'appSecret', code: 'invalid_app_secret' }),
        expect.objectContaining({ path: 'displayPhoneNumber', code: 'invalid_phone' }),
      ]),
    );
  });

  it('connects a number to one account only', async () => {
    const ana = await signUp('ana@example.com');
    const beto = await signUp('beto@example.com');
    await call(ana, 'POST', '/whatsapp/channels', credentials);

    const again = await call(beto, 'POST', '/whatsapp/channels', credentials);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'whatsapp_number_already_connected' });
    // The rejected attempt leaves no credentials behind.
    const { rows } = await owner.query('select id from encrypted_secrets');
    expect(rows).toHaveLength(2);
  });

  it('manages authorized phones with their default RFC', async () => {
    const token = await signUp('ana@example.com');
    const channel = (await call(token, 'POST', '/whatsapp/channels', credentials)).json<Channel>();
    const profile = (await call(token, 'POST', '/fiscal-profiles', andina)).json<{ id: string }>();
    const senders = `/whatsapp/channels/${channel.id}/senders`;

    const added = await call(token, 'POST', senders, {
      waId: '+52 55 8765 4321',
      label: 'Juan · ventas',
      defaultFiscalProfileId: profile.id,
    });
    expect(added.statusCode).toBe(201);
    const sender = added.json<{ id: string }>();
    expect(added.json()).toMatchObject({
      waId: '525587654321',
      label: 'Juan · ventas',
      defaultFiscalProfileId: profile.id,
    });

    expect((await call(token, 'POST', senders, { waId: '5587654321' })).statusCode).toBe(409);

    const edited = await call(token, 'PATCH', `${senders}/${sender.id}`, { label: 'Juan' });
    expect(edited.json()).toMatchObject({ label: 'Juan', defaultFiscalProfileId: profile.id });

    // The RFC a sender invoices to cannot be deleted while they use it.
    const deleteProfile = await call(token, 'DELETE', `/fiscal-profiles/${profile.id}`);
    expect(deleteProfile.statusCode).toBe(409);

    expect((await call(token, 'DELETE', `${senders}/${sender.id}`)).statusCode).toBe(204);
    expect((await call(token, 'DELETE', `${senders}/${sender.id}`)).statusCode).toBe(404);
  });

  it('keeps each account to its own numbers and RFCs', async () => {
    const ana = await signUp('ana@example.com');
    const beto = await signUp('beto@example.com');
    const channel = (await call(ana, 'POST', '/whatsapp/channels', credentials)).json<Channel>();
    const betoProfile = (await call(beto, 'POST', '/fiscal-profiles', andina)).json<{
      id: string;
    }>();

    expect(
      (await call(beto, 'GET', '/whatsapp/channels')).json<{ items: Channel[] }>().items,
    ).toEqual([]);
    expect((await call(beto, 'DELETE', `/whatsapp/channels/${channel.id}`)).statusCode).toBe(404);
    expect(
      (await call(beto, 'POST', `/whatsapp/channels/${channel.id}/senders`, { waId: '5511112222' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(beto, 'POST', `/whatsapp/channels/${channel.id}/verify-token`)).statusCode,
    ).toBe(404);

    // Ana cannot point a sender at Beto's RFC.
    const foreign = await call(ana, 'POST', `/whatsapp/channels/${channel.id}/senders`, {
      waId: '5511112222',
      defaultFiscalProfileId: betoProfile.id,
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json<{ errors: { code: string }[] }>().errors[0]?.code).toBe(
      'unknown_fiscal_profile',
    );
  });

  it('disconnects a number with its phones and credentials', async () => {
    const token = await signUp('ana@example.com');
    const channel = (await call(token, 'POST', '/whatsapp/channels', credentials)).json<Channel>();
    await call(token, 'POST', `/whatsapp/channels/${channel.id}/senders`, { waId: '5587654321' });

    expect((await call(token, 'DELETE', `/whatsapp/channels/${channel.id}`)).statusCode).toBe(204);

    const secrets = await owner.query('select id from encrypted_secrets');
    const senders = await owner.query('select id from whatsapp_senders');
    expect(secrets.rows).toHaveLength(0);
    expect(senders.rows).toHaveLength(0);
    expect((await verifyWebhook(channel.id, channel.verifyToken!)).statusCode).toBe(403);
  });
});
