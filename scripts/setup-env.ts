/**
 * Creates .env from .env.example with random local secrets and matching
 * database URLs. Usage: npm run setup:env [-- --force]
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const TARGET = '.env';

if (existsSync(TARGET) && !process.argv.includes('--force')) {
  console.error('.env already exists. Run `npm run setup:env -- --force` to overwrite it.');
  process.exit(1);
}

const secret = (bytes: number) => randomBytes(bytes).toString('base64url');
const lines = readFileSync('.env.example', 'utf8').split(/\r?\n/);
const values = new Map<string, string>();
for (const line of lines) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match) {
    values.set(match[1]!, match[2]!);
  }
}

const ownerPassword = secret(24);
const appPassword = secret(24);
const port = values.get('POSTGRES_PORT') || '5432';
const database = values.get('POSTGRES_DB') || 'ticbo';
const owner = values.get('POSTGRES_USER') || 'ticbo_owner';

values.set('POSTGRES_PASSWORD', ownerPassword);
values.set('POSTGRES_APP_PASSWORD', appPassword);
values.set('DATABASE_URL', `postgres://ticbo_app:${appPassword}@localhost:${port}/${database}`);
values.set(
  'DATABASE_MIGRATION_URL',
  `postgres://${owner}:${ownerPassword}@localhost:${port}/${database}`,
);
values.set('JWT_ACCESS_SECRET', secret(48));
values.set('COOKIE_SECRET', secret(48));

const output = lines.map((line) => {
  const key = /^([A-Z0-9_]+)=/.exec(line)?.[1];
  return key ? `${key}=${values.get(key) ?? ''}` : line;
});
writeFileSync(TARGET, output.join('\n'), { mode: 0o600 });
console.log('Wrote .env with freshly generated local secrets.');
