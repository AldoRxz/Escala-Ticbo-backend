import { describe, expect, it } from 'vitest';
import { loadConfig } from './load-config.js';

const validEnv = {
  API_PUBLIC_URL: 'http://localhost:4000/',
  WEB_APP_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000, https://app.ticbo.com',
  DATABASE_URL: 'postgres://ticbo_app:secret@localhost:5432/ticbo',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  COOKIE_SECRET: 'b'.repeat(32),
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

  it('requires https in production', () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'production' })).toThrow(/https/);
  });
});
