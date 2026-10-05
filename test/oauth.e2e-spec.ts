import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase, startTestApp } from './support/e2e.js';

describe('OAuth (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: pg.Pool;

  beforeAll(async () => {
    owner = await prepareDatabase();
    app = await startTestApp({
      GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-secret',
    });
  });

  afterAll(async () => {
    await app.close();
    await owner.end();
  });

  async function startGoogle() {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/google' });
    const location = new URL(response.headers.location as string);
    const cookie = response.cookies.find((candidate) => candidate.name === 'ticbo_oauth')!;
    return { response, location, cookie };
  }

  it('redirects to Google with PKCE and keeps state in a signed cookie', async () => {
    const { response, location, cookie } = await startGoogle();

    expect(response.statusCode).toBe(302);
    expect(location.host).toBe('accounts.google.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:4000/api/v1/auth/oauth/google/callback',
    );
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/api/v1/auth/oauth/google',
      maxAge: 600,
    });
  });

  it('sends the browser back to the app when the state does not match', async () => {
    const { cookie } = await startGoogle();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/google/callback?code=abc&state=forged',
      cookies: { ticbo_oauth: cookie.value },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      'http://localhost:3000/login?error=oauth_state_mismatch',
    );
    expect(response.cookies.find((candidate) => candidate.name === 'ticbo_rt')).toBeUndefined();
  });

  it('rejects a tampered state cookie', async () => {
    const { location, cookie } = await startGoogle();
    const state = location.searchParams.get('state')!;

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/google/callback?code=abc&state=${state}`,
      cookies: { ticbo_oauth: `${cookie.value.slice(0, -2)}xx` },
    });

    expect(response.headers.location).toBe(
      'http://localhost:3000/login?error=oauth_state_mismatch',
    );
  });

  it('reports a sign-in the user cancelled', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/google/callback?error=access_denied',
    });

    expect(response.headers.location).toBe('http://localhost:3000/login?error=oauth_denied');
  });

  it('answers 404 for providers that are not enabled', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/oauth/facebook' });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('oauth_provider_not_enabled');
  });
});
