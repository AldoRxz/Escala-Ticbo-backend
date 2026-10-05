import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type Database, DATABASE } from './database.tokens.js';

@Injectable()
export class DatabaseHealth {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** True when the database answers a trivial query within `timeoutMs`. */
  async isUp(timeoutMs = 2_000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Database health check timed out')), timeoutMs);
    });
    try {
      await Promise.race([this.db.execute(sql`select 1`), timeout]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
