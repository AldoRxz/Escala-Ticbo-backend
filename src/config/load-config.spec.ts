import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './load-config.js';

const vaultKey = randomBytes(32);

const validEnv = {
  API_PUBLIC_URL: 'http://localhost:4000/',
  WEB_APP_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000, https://app.ticbo.com',
  DATABASE_URL: 'postgres://ticbo_app:secret@localhost:5432/ticbo',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  COOKIE_SECRET: 'b'.repeat(32),
  VAULT_KEYS: `local-v1:${vaultKey.toString('base64')}`,
};

describe('loadConfig', () => {
  it('applies defaults and normalizes URLs', () => {
    const config = loadConfig(validEnv);

    expect(config.http.port).toBe(4000);
    expect(config.http.apiPublicUrl).toBe('http://localhost:4000');
    expect(config.http.corsOrigins).toEqual(['http://localhost:3000', 'https://app.ticbo.com']);
    expect(config.auth.accessToken.ttlSeconds).toBe(900);
    expect(config.auth.argon2).toEqual({ memoryKib: 19_456, timeCost: 2, parallelism: 1 });
    expect(config.auth.cookieSecure).toBe(false);
    expect(config.auth.google).toBeNull();
  });

  it('treats empty assignments as unset', () => {
    const config = loadConfig({ ...validEnv, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });

    expect(config.auth.google).toBeNull();
  });

  it('builds the Google redirect URI from the public API URL', () => {
    const config = loadConfig({
      ...validEnv,
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
    });

    expect(config.auth.google?.redirectUri).toBe(
      'http://localhost:4000/api/v1/auth/oauth/google/callback',
    );
  });

  it('lists every invalid variable without echoing secret values', () => {
    const attempt = () =>
      loadConfig({ ...validEnv, JWT_ACCESS_SECRET: 'too-short', DATABASE_URL: 'not-a-url' });

    expect(attempt).toThrow(/JWT_ACCESS_SECRET/);
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).not.toThrow(/too-short/);
  });

  it('requires both Google credentials together', () => {
    expect(() => loadConfig({ ...validEnv, GOOGLE_CLIENT_ID: 'client-id' })).toThrow(
      /must be set together/,
    );
  });

  it('parses vault keys, the first one being active', () => {
    const second = randomBytes(32);
    const config = loadConfig({
      ...validEnv,
      VAULT_KEYS: `local-v2:${second.toString('base64url')}, ${validEnv.VAULT_KEYS}`,
    });

    expect(config.vault.keys.map((key) => key.id)).toEqual(['local-v2', 'local-v1']);
    expect(config.vault.keys[0]?.key.equals(second)).toBe(true);
    expect(config.vault.keys[1]?.key.equals(vaultKey)).toBe(true);
  });

  it.each([
    ['a short key', `local-v1:${randomBytes(16).toString('base64')}`],
    ['a missing id', randomBytes(32).toString('base64')],
    ['a repeated id', `k:${randomBytes(32).toString('base64')},k:${randomBytes(32).toString('base64')}`],
  ])('rejects vault keys with %s', (_, value) => {
    expect(() => loadConfig({ ...validEnv, VAULT_KEYS: value })).toThrow(/VAULT_KEYS/);
  });

  it('accepts a single-line CA certificate for the database', () => {
    const config = loadConfig({
      ...validEnv,
      DATABASE_SSL: 'true',
      DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----',
    });

    expect(config.database.sslCa).toBe(
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    );
  });

  it('requires https in production', () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'production' })).toThrow(/https/);
  });
});
