import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OAuthExchangeFailedError } from '../../application/errors.js';
import { FixedClock } from '../../application/testing/fakes.js';
import { GoogleOAuthProvider } from './google-oauth.provider.js';

const config = {
  clientId: 'client-id.apps.googleusercontent.com',
  clientSecret: 'client-secret',
  redirectUri: 'http://localhost:4000/api/v1/auth/oauth/google/callback',
};

const clock = new FixedClock();
const nowSeconds = Math.floor(clock.now().getTime() / 1000);

function idToken(claims: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}

const validClaims = {
  iss: 'https://accounts.google.com',
  aud: config.clientId,
  sub: '1234567890',
  exp: nowSeconds + 300,
  nonce: 'nonce-1',
  email: 'ana@example.com',
  email_verified: true,
  name: 'Ana López',
  picture: 'https://lh3.googleusercontent.com/a/ana',
};

function providerAnswering(body: unknown, status = 200) {
  const requests: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, body: init?.body as URLSearchParams });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { provider: new GoogleOAuthProvider(config, clock, fetchFn), requests };
}

describe('GoogleOAuthProvider', () => {
  it('builds an authorization URL with PKCE S256, state and nonce', () => {
    const { provider } = providerAnswering({});
    const request = provider.createAuthorizationRequest();
    const url = new URL(request.url);

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: request.state,
      nonce: request.nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(request.codeVerifier).digest('base64url'),
    });
    expect(url.searchParams.has('code_verifier')).toBe(false);
    expect(request.codeVerifier.length).toBeGreaterThanOrEqual(43);
  });

  it('exchanges the code with the verifier and maps the profile', async () => {
    const { provider, requests } = providerAnswering({ id_token: idToken(validClaims) });

    const profile = await provider.exchangeCode({
      code: 'auth-code',
      codeVerifier: 'verifier',
      nonce: 'nonce-1',
    });

    expect(profile).toEqual({
      provider: 'google',
      subject: '1234567890',
      email: 'ana@example.com',
      emailVerified: true,
      fullName: 'Ana López',
      avatarUrl: 'https://lh3.googleusercontent.com/a/ana',
    });
    expect(requests[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(requests[0]!.body)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'auth-code',
      code_verifier: 'verifier',
      redirect_uri: config.redirectUri,
    });
  });

  it.each([
    ['another audience', { aud: 'someone-else' }],
    ['another issuer', { iss: 'https://evil.example.com' }],
    ['a replayed nonce', { nonce: 'other-nonce' }],
    ['an expired token', { exp: nowSeconds - 3600 }],
  ])('rejects an ID token with %s', async (_, override) => {
    const { provider } = providerAnswering({ id_token: idToken({ ...validClaims, ...override }) });

    await expect(
      provider.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: 'nonce-1' }),
    ).rejects.toThrow(OAuthExchangeFailedError);
  });

  it('reports an unverified email instead of trusting it', async () => {
    const { provider } = providerAnswering({
      id_token: idToken({ ...validClaims, email_verified: false }),
    });

    const profile = await provider.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: 'nonce-1' });

    expect(profile.emailVerified).toBe(false);
  });

  it('fails cleanly when Google rejects the code or is unreachable', async () => {
    const rejected = providerAnswering({ error: 'invalid_grant' }, 400).provider;
    const unreachable = new GoogleOAuthProvider(config, clock, (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);

    await expect(
      rejected.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: 'nonce-1' }),
    ).rejects.toThrow(OAuthExchangeFailedError);
    await expect(
      unreachable.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: 'nonce-1' }),
    ).rejects.toThrow(OAuthExchangeFailedError);
  });
});
