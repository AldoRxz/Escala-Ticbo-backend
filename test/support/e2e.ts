import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { createApp } from '../../src/bootstrap/create-app.js';
import type { AppConfig } from '../../src/config/app-config.js';
import { loadConfig } from '../../src/config/load-config.js';
import { runMigrations } from '../../src/shared/infrastructure/database/migrate.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set: run \`npm run setup:env\` and \`npm run db:up\` first.`);
  }
  return value;
}

/** Same server and credentials as .env, on the `<database>_test` database. */
function testDatabase(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_test`;
  return parsed.toString();
}

export const testDatabaseUrls = {
  app: process.env.TEST_DATABASE_URL ?? testDatabase(requiredEnv('DATABASE_URL')),
  owner:
    process.env.TEST_DATABASE_MIGRATION_URL ??
    testDatabase(requiredEnv('DATABASE_MIGRATION_URL')),
};

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    API_PUBLIC_URL: 'http://localhost:4000',
    WEB_APP_URL: 'http://localhost:3000',
    CORS_ORIGINS: 'http://localhost:3000',
    DATABASE_URL: testDatabaseUrls.app,
    DATABASE_POOL_MAX: '4',
    JWT_ACCESS_SECRET: randomBytes(32).toString('base64url'),
    COOKIE_SECRET: randomBytes(32).toString('base64url'),
    // Cheaper hashing keeps the suite fast; production uses the OWASP baseline.
    ARGON2_MEMORY_KIB: '8192',
    ARGON2_TIME_COST: '1',
    REFRESH_REUSE_GRACE_SECONDS: '0',
    ...overrides,
  });
}

export async function startTestApp(
  overrides: Record<string, string> = {},
): Promise<NestFastifyApplication> {
  const app = await createApp(testConfig(overrides));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** Applies migrations and returns an owner connection for fixtures and assertions. */
export async function prepareDatabase(): Promise<pg.Pool> {
  await runMigrations(testDatabaseUrls.owner);
  return new pg.Pool({ connectionString: testDatabaseUrls.owner, max: 2 });
}

export async function resetDatabase(owner: pg.Pool): Promise<void> {
  // CASCADE reaches every table that references these roots.
  await owner.query('TRUNCATE users, accounts, merchants CASCADE');
}
