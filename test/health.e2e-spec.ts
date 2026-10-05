import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase, startTestApp } from './support/e2e.js';

describe('Health and HTTP hardening (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: pg.Pool;

  beforeAll(async () => {
    owner = await prepareDatabase();
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
    await owner.end();
  });

  it('reports readiness with the database check', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });

  it('reports liveness without touching dependencies', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('sends security headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows credentialed CORS only from configured origins', async () => {
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/refresh',
        headers: { origin, 'access-control-request-method': 'POST' },
      });

    const allowed = await preflight('http://localhost:3000');
    const denied = await preflight('https://evil.example.com');

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers unknown routes with problem details', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 404, code: 'not_found' });
  });
});
