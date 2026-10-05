import { defineConfig } from 'vitest/config';

// End-to-end tests run against a real PostgreSQL (see README: `npm run db:up`).
// They share one database, so files run one at a time.
export default defineConfig({
  test: {
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
