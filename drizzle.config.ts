import { defineConfig } from 'drizzle-kit';

// Schema changes: edit src/shared/infrastructure/database/schema, then `npm run db:generate`.
// Row-level security, grants and other hand-written SQL go in `drizzle-kit generate --custom`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/infrastructure/database/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? '',
  },
  strict: true,
  verbose: true,
});
