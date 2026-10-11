/**
 * Applies pending migrations from ./drizzle with the owner role
 * (DATABASE_MIGRATION_URL). The API itself connects with a restricted role.
 *
 *   local Docker:  npm run db:migrate
 *   Supabase:      npm run db:migrate:supabase
 *   container:     node dist/shared/infrastructure/database/migrate.js
 *
 * Runs directly with Node (type stripping), so it reads its few settings here
 * instead of importing the app's config module.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** TLS with certificate verification when DATABASE_SSL=true (same rules as the API). */
export function sslFromEnv(env: NodeJS.ProcessEnv = process.env): pg.PoolConfig['ssl'] {
  if (env.DATABASE_SSL !== 'true') {
    return undefined;
  }
  const ca = env.DATABASE_SSL_CA;
  if (!ca) {
    return { rejectUnauthorized: true };
  }
  const pem = ca.includes('-----BEGIN CERTIFICATE-----')
    ? ca.replace(/\\n/g, '\n')
    : readFileSync(resolve(ca), 'utf8');
  return { rejectUnauthorized: true, ca: pem };
}

export async function runMigrations(
  connectionString: string,
  migrationsFolder: string = resolve(process.cwd(), 'drizzle'),
  ssl?: pg.PoolConfig['ssl'],
): Promise<void> {
  const pool = new pg.Pool({ connectionString, ssl, max: 1, application_name: 'ticbo-migrate' });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (invokedDirectly) {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    console.error('DATABASE_MIGRATION_URL is not set.');
    process.exit(1);
  }
  try {
    await runMigrations(url, undefined, sslFromEnv());
    console.log('Migrations applied.');
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
