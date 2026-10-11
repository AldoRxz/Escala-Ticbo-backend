import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLambdaHandler } from '../src/bootstrap/create-lambda-handler.js';
import { prepareDatabase, resetDatabase, testConfig } from './support/e2e.js';

type Handler = Awaited<ReturnType<typeof createLambdaHandler>>;

/** Minimal API Gateway HTTP API (payload 2.0) event. */
function httpApiEvent(
  method: string,
  path: string,
  options: { body?: object; cookies?: string[]; headers?: Record<string, string> } = {},
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    cookies: options.cookies,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'lambda-e2e',
      ...options.headers,
    },
    requestContext: {
      accountId: '123456789012',
      apiId: 'api',
      domainName: 'api.ticbo.test',
      domainPrefix: 'api',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '203.0.113.7',
        userAgent: 'lambda-e2e',
      },
      requestId: 'request-id',
      routeKey: '$default',
      stage: '$default',
      time: '05/Oct/2026:12:00:00 +0000',
      timeEpoch: 1_791_201_600_000,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    isBase64Encoded: false,
  };
}

const context = { callbackWaitsForEmptyEventLoop: true } as Context;

describe('Lambda handler (e2e)', () => {
  let handler: Handler;
  let owner: pg.Pool;

  beforeAll(async () => {
    owner = await prepareDatabase();
    handler = await createLambdaHandler(testConfig());
  });

  afterAll(async () => {
    await owner.end();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
  });

  it('answers the health probe', async () => {
    const response = await handler(httpApiEvent('GET', '/api/v1/health'), context);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });

  it('registers, returns the refresh cookie in the 2.0 format and refreshes with it', async () => {
    const registered = await handler(
      httpApiEvent('POST', '/api/v1/auth/register', {
        body: { email: 'ana@example.com', password: 'correct horse battery', fullName: 'Ana' },
      }),
      context,
    );

    expect(registered.statusCode).toBe(201);
    const cookie = registered.cookies?.find((value) => value.startsWith('ticbo_rt='));
    expect(cookie).toContain('HttpOnly');

    const refreshed = await handler(
      httpApiEvent('POST', '/api/v1/auth/refresh', { cookies: [cookie!.split(';')[0]!] }),
      context,
    );
    expect(refreshed.statusCode).toBe(200);
    expect(JSON.parse(refreshed.body).accessToken).toEqual(expect.any(String));
  });

  it('records the client IP that API Gateway reports', async () => {
    await handler(
      httpApiEvent('POST', '/api/v1/auth/register', {
        body: { email: 'ip@example.com', password: 'correct horse battery', fullName: 'Ip' },
      }),
      context,
    );

    const { rows } = await owner.query<{ ip_address: string }>(
      'select ip_address from refresh_tokens',
    );
    expect(rows[0]?.ip_address).toBe('203.0.113.7');
  });
});
