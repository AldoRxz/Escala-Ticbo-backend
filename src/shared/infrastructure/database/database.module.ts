import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { AppConfig } from '../../../config/app-config.js';
import { DatabaseHealth } from './database-health.js';
import { DATABASE, DATABASE_POOL } from './database.tokens.js';
import * as schema from './schema/index.js';
import { TenantDatabase } from './tenant-database.js';

function createPool(config: AppConfig): pg.Pool {
  const logger = new Logger('Database');
  const pool = new pg.Pool({
    connectionString: config.database.url,
    // Keep this small: a pooler (PgBouncer / provider pooler) multiplexes instances.
    max: config.database.poolMax,
    ssl: config.database.ssl ? { rejectUnauthorized: true } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 15_000,
    application_name: 'ticbo-api',
  });
  // Idle clients can lose their connection (failover, network blips). Without a
  // listener the 'error' event would crash the process.
  pool.on('error', (error) => logger.error(`Idle PostgreSQL client error: ${error.message}`));
  return pool;
}

@Global()
@Module({
  providers: [
    { provide: DATABASE_POOL, inject: [AppConfig], useFactory: createPool },
    {
      provide: DATABASE,
      inject: [DATABASE_POOL],
      useFactory: (pool: pg.Pool) => drizzle(pool, { schema }),
    },
    TenantDatabase,
    DatabaseHealth,
  ],
  exports: [DATABASE, TenantDatabase, DatabaseHealth],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
