import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  type Database,
  DATABASE,
} from '../../../../shared/infrastructure/database/database.tokens.js';
import { authThrottles } from '../../../../shared/infrastructure/database/schema/index.js';
import type { LoginThrottleStore } from '../../application/ports/login-throttle.js';
import type { ThrottleState } from '../../domain/login-throttle.js';

/** Rows are keyed by a hash of the normalized email: no address is stored. */
function keyFor(email: string): string {
  return createHash('sha256').update(`login:${email.trim().toLowerCase()}`).digest('hex');
}

@Injectable()
export class DrizzleLoginThrottleStore implements LoginThrottleStore {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async get(email: string): Promise<ThrottleState | null> {
    const [row] = await this.db
      .select()
      .from(authThrottles)
      .where(eq(authThrottles.key, keyFor(email)))
      .limit(1);
    return row ?? null;
  }

  async update(email: string, next: (state: ThrottleState | null) => ThrottleState): Promise<void> {
    const key = keyFor(email);
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(authThrottles)
        .where(eq(authThrottles.key, key))
        .for('update')
        .limit(1);
      const state = next(row ?? null);
      await tx
        .insert(authThrottles)
        .values({ key, ...state, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: authThrottles.key,
          set: { ...state, updatedAt: new Date() },
        });
    });
  }

  async clear(email: string): Promise<void> {
    await this.db.delete(authThrottles).where(eq(authThrottles.key, keyFor(email)));
  }
}
