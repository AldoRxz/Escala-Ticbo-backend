import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/shared/domain/id.js';
import { prepareDatabase, resetDatabase, startTestApp } from './support/e2e.js';

const andina = {
  rfc: 'gas190214 8k3',
  legalName: 'Grupo Andina',
  taxRegime: '601',
  postalCode: '06600',
  defaultCfdiUse: 'G03',
};
const logistica = { ...andina, rfc: 'ALO2005117T2', legalName: 'Andina Logística' };

describe('Fiscal profiles (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: pg.Pool;

  async function signUp(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'correct horse battery', fullName: 'Prueba' },
    });
    expect(response.statusCode).toBe(201);
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
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
    await owner.end();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
  });

  it('requires a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/fiscal-profiles' });
    expect(response.statusCode).toBe(401);
  });

  it('serves the SAT catalogs', async () => {
    const token = await signUp('ana@example.com');
    const response = await call(token, 'GET', '/fiscal-profiles/catalog');

    expect(response.statusCode).toBe(200);
    const body = response.json<{ taxRegimes: { code: string }[]; cfdiUses: { code: string }[] }>();
    expect(body.taxRegimes.map((r) => r.code)).toContain('626');
    expect(body.cfdiUses.map((u) => u.code)).toContain('G03');
  });

  it('creates, lists, edits and deletes profiles', async () => {
    const token = await signUp('ana@example.com');

    const created = await call(token, 'POST', '/fiscal-profiles', andina);
    expect(created.statusCode).toBe(201);
    const first = created.json<{ id: string; invoiceEmail: string }>();
    expect(created.json()).toMatchObject({
      rfc: 'GAS1902148K3',
      personType: 'moral',
      legalName: 'GRUPO ANDINA',
      isDefault: true,
      verifiedAt: null,
    });
    expect(first.invoiceEmail).toMatch(/^ticbomx\+[a-z2-9]{8}@gmail\.com$/);

    const second = (await call(token, 'POST', '/fiscal-profiles', logistica)).json<{
      id: string;
    }>();
    const list = await call(token, 'GET', '/fiscal-profiles');
    expect(list.json<{ items: { rfc: string; isDefault: boolean }[] }>().items).toEqual([
      expect.objectContaining({ rfc: 'GAS1902148K3', isDefault: true }),
      expect.objectContaining({ rfc: 'ALO2005117T2', isDefault: false }),
    ]);

    const edited = await call(token, 'PATCH', `/fiscal-profiles/${first.id}`, {
      postalCode: '64000',
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ postalCode: '64000', rfc: 'GAS1902148K3' });

    const madeDefault = await call(token, 'POST', `/fiscal-profiles/${second.id}/default`);
    expect(madeDefault.json()).toMatchObject({ isDefault: true });

    expect((await call(token, 'DELETE', `/fiscal-profiles/${second.id}`)).statusCode).toBe(204);
    const remaining = (await call(token, 'GET', '/fiscal-profiles')).json<{
      items: { id: string; isDefault: boolean }[];
    }>();
    expect(remaining.items).toEqual([expect.objectContaining({ id: first.id, isDefault: true })]);
  });

  it('reports invalid fields one by one', async () => {
    const token = await signUp('ana@example.com');
    const response = await call(token, 'POST', '/fiscal-profiles', {
      ...andina,
      taxRegime: '612',
      postalCode: '6600',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; errors: { path: string; code: string }[] }>();
    expect(body.code).toBe('validation_failed');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'postalCode', code: 'invalid_postal_code' }),
        expect.objectContaining({ path: 'taxRegime', code: 'tax_regime_not_allowed' }),
      ]),
    );

    // An edit is checked against the stored RFC too.
    const { id } = (await call(token, 'POST', '/fiscal-profiles', andina)).json<{ id: string }>();
    const edit = await call(token, 'PATCH', `/fiscal-profiles/${id}`, { defaultCfdiUse: 'D01' });
    expect(edit.statusCode).toBe(400);
    expect(edit.json<{ errors: { code: string }[] }>().errors[0]?.code).toBe(
      'cfdi_use_not_allowed',
    );
  });

  it('rejects the same RFC twice in an account', async () => {
    const token = await signUp('ana@example.com');
    await call(token, 'POST', '/fiscal-profiles', andina);

    const again = await call(token, 'POST', '/fiscal-profiles', { ...andina, rfc: 'GAS1902148K3' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'fiscal_profile_rfc_taken' });
  });

  it('keeps each account’s profiles to itself', async () => {
    const ana = await signUp('ana@example.com');
    const beto = await signUp('beto@example.com');
    const { id } = (await call(ana, 'POST', '/fiscal-profiles', andina)).json<{ id: string }>();

    // The same RFC can exist in another account, as its own profile.
    expect((await call(beto, 'POST', '/fiscal-profiles', andina)).statusCode).toBe(201);
    expect(
      (await call(beto, 'GET', '/fiscal-profiles')).json<{ items: unknown[] }>().items,
    ).toHaveLength(1);
    expect(
      (await call(beto, 'PATCH', `/fiscal-profiles/${id}`, { postalCode: '64000' })).statusCode,
    ).toBe(404);
    expect((await call(beto, 'DELETE', `/fiscal-profiles/${id}`)).statusCode).toBe(404);
    expect((await call(beto, 'POST', `/fiscal-profiles/${id}/default`)).statusCode).toBe(404);
  });

  it('does not delete a profile that receipts already use', async () => {
    const token = await signUp('ana@example.com');
    const profile = (await call(token, 'POST', '/fiscal-profiles', andina)).json<{ id: string }>();
    const { rows } = await owner.query<{ account_id: string }>(
      'select account_id from fiscal_profiles where id = $1',
      [profile.id],
    );
    await owner.query(
      `insert into receipts (id, account_id, fiscal_profile_id, source, source_message_id, image_object_key)
       values ($1, $2, $3, 'whatsapp', 'wamid.1', 'receipts/1.jpg')`,
      [newId(), rows[0]!.account_id, profile.id],
    );

    const response = await call(token, 'DELETE', `/fiscal-profiles/${profile.id}`);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'fiscal_profile_in_use' });
  });

  it('rejects ids that are not UUIDs', async () => {
    const token = await signUp('ana@example.com');
    expect((await call(token, 'DELETE', '/fiscal-profiles/not-an-id')).statusCode).toBe(400);
  });
});
