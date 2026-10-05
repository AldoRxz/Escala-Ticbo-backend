/**
 * Applies pending migrations from ./drizzle with the owner role
 * (DATABASE_MIGRATION_URL). The API itself connects with a restricted role.
 *
 *   development:  npm run db:migrate
 *   container:    node dist/shared/infrastructure/database/migrate.js
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export async function runMigrations(
  connectionString: string,
  migrationsFolder: string = resolve(process.cwd(), 'drizzle'),
): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1, application_name: 'ticbo-migrate' });
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
    await runMigrations(url);
    console.log('Migrations applied.');
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
