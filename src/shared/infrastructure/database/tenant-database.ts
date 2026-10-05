import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type Database, DATABASE, type Transaction } from './database.tokens.js';

/**
 * Entry point for tenant data. `run` opens a transaction scoped to one account:
 * row-level security then hides and protects every other account's rows.
 * `set_config(..., true)` lasts until the end of the transaction, so it is safe
 * with transaction-mode poolers (PgBouncer) and never leaks to another request.
 */
@Injectable()
export class TenantDatabase {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  run<T>(accountId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.account_id', ${accountId}, true)`);
      return work(tx);
    });
  }
}
