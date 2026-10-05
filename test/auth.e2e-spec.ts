import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prepareDatabase, resetDatabase, startTestApp } from './support/e2e.js';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

const ana = { email: 'Ana@Example.com', password: 'correct horse battery', fullName: 'Ana López' };

function refreshCookie(response: InjectResponse) {
  return response.cookies.find((cookie) => cookie.name === 'ticbo_rt');
}

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: pg.Pool;

  const register = (payload: object = ana) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
  const login = (payload: object) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
  const refresh = (token: string) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { ticbo_rt: token } });

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

  it('registers a user with a personal account and starts a session', async () => {
    const response = await register();

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { email: 'ana@example.com', fullName: 'Ana López', emailVerified: false },
      account: { name: 'Ana López', type: 'personal', role: 'owner' },
    });
    expect(JSON.stringify(body)).not.toContain('argon2');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(refreshCookie(response)).toMatchObject({
      httpOnly: true,
      sameSite: 'Strict',
      path: '/api/v1/auth',
    });

    const { rows } = await owner.query<{ password_hash: string }>('select password_hash from users');
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('rejects an email that is already registered', async () => {
    await register();

    const response = await register({ ...ana, email: 'ana@EXAMPLE.com' });

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 409, code: 'email_already_registered' });
  });

  it('reports every invalid field', async () => {
    const response = await register({ email: 'not-an-email', password: 'short', extra: true });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe('validation_failed');
    expect(body.errors.map((error: { path: string }) => error.path).sort()).toEqual([
      '',
      'email',
      'fullName',
      'password',
    ]);
  });

  it('signs in only with the right password', async () => {
    await register();

    const wrong = await login({ email: ana.email, password: 'not the password' });
    const unknown = await login({ email: 'nobody@example.com', password: 'whatever it is' });
    const right = await login({ email: 'ANA@example.com', password: ana.password });

    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('invalid_credentials');
    expect(unknown.json()).toEqual({ ...wrong.json(), requestId: unknown.json().requestId });
    expect(right.statusCode).toBe(200);
    expect(right.json().user.email).toBe('ana@example.com');
  });

  it('protects routes with the bearer token', async () => {
    const { accessToken, user, account } = (await register()).json();

    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/me' });
    const forged = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${accessToken}x` },
    });
    const authorized = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['www-authenticate']).toBe('Bearer');
    expect(anonymous.json().code).toBe('authentication_required');
    expect(forged.statusCode).toBe(401);
    expect(forged.json().code).toBe('invalid_access_token');
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toEqual({
      user,
      activeAccountId: account.id,
      accounts: [account],
    });
  });

  it('rotates the refresh token and revokes the family when an old one is replayed', async () => {
    const first = refreshCookie(await register())!.value;

    const rotated = await refresh(first);
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().accessToken).toEqual(expect.any(String));
    const second = refreshCookie(rotated)!.value;
    expect(second).not.toBe(first);

    const replay = await refresh(first);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('invalid_refresh_token');
    expect(refreshCookie(replay)?.value).toBe('');

    // The legitimate holder is logged out too: the leaked family is dead.
    expect((await refresh(second)).statusCode).toBe(401);
  });

  it('logs out by revoking the session', async () => {
    const token = refreshCookie(await register())!.value;

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { ticbo_rt: token },
    });

    expect(logout.statusCode).toBe(204);
    expect(refreshCookie(logout)?.value).toBe('');
    expect((await refresh(token)).statusCode).toBe(401);
  });

  it('refuses a refresh without cookie', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh' });

    expect(response.statusCode).toBe(401);
  });
});
