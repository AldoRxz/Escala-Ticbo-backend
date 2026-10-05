import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  type Database,
  DATABASE,
} from '../../../../shared/infrastructure/database/database.tokens.js';
import { refreshTokens } from '../../../../shared/infrastructure/database/schema/index.js';
import type {
  NewRefreshSession,
  RefreshSession,
  SessionRepository,
} from '../../application/ports/session.repository.js';

@Injectable()
export class DrizzleSessionRepository implements SessionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(session: NewRefreshSession): Promise<void> {
    await this.db.insert(refreshTokens).values(session);
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshSession | null> {
    const [row] = await this.db
      .select({
        id: refreshTokens.id,
        userId: refreshTokens.userId,
        familyId: refreshTokens.familyId,
        tokenHash: refreshTokens.tokenHash,
        expiresAt: refreshTokens.expiresAt,
        revokedAt: refreshTokens.revokedAt,
        replacedById: refreshTokens.replacedById,
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async rotate(currentId: string, next: NewRefreshSession, now: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Compare-and-set: of two concurrent rotations, the second one waits for the
      // row lock, re-checks `revoked_at is null`, matches nothing and gives up.
      const retired = await tx
        .update(refreshTokens)
        .set({ revokedAt: now, replacedById: next.id })
        .where(and(eq(refreshTokens.id, currentId), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      if (retired.length === 0) {
        return false;
      }
      await tx.insert(refreshTokens).values(next);
      return true;
    });
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}
