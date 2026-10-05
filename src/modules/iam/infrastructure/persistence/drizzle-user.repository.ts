import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { newId } from '../../../../shared/domain/id.js';
import {
  type Database,
  DATABASE,
} from '../../../../shared/infrastructure/database/database.tokens.js';
import { isUniqueViolation } from '../../../../shared/infrastructure/database/pg-errors.js';
import {
  accountMembers,
  accounts,
  userIdentities,
  users,
} from '../../../../shared/infrastructure/database/schema/index.js';
import type {
  LinkIdentityOptions,
  NewIdentity,
  ProvisionUserInput,
  UserRepository,
} from '../../application/ports/user.repository.js';
import type { Email } from '../../domain/email.js';
import { EmailAlreadyRegisteredError } from '../../domain/errors.js';
import type { OAuthProviderName } from '../../domain/oauth.js';
import type { Membership, User } from '../../domain/user.js';

type UserRow = typeof users.$inferSelect;

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    emailVerifiedAt: row.emailVerifiedAt,
    passwordHash: row.passwordHash,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toUser(row) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email.value)).limit(1);
    return row ? toUser(row) : null;
  }

  async findByIdentity(provider: OAuthProviderName, subject: string): Promise<User | null> {
    const [row] = await this.db
      .select({ user: users })
      .from(userIdentities)
      .innerJoin(users, eq(users.id, userIdentities.userId))
      .where(and(eq(userIdentities.provider, provider), eq(userIdentities.subject, subject)))
      .limit(1);
    return row ? toUser(row.user) : null;
  }

  async provision({ user, personalAccount, identity }: ProvisionUserInput): Promise<User> {
    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx.insert(users).values(user).returning();
        await tx
          .insert(accounts)
          .values({ id: personalAccount.id, name: personalAccount.name, type: 'personal' });
        await tx
          .insert(accountMembers)
          .values({ accountId: personalAccount.id, userId: user.id, role: 'owner' });
        if (identity) {
          await tx.insert(userIdentities).values({ id: newId(), userId: user.id, ...identity });
        }
        return toUser(created!);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_key')) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }

  async linkIdentity(
    userId: string,
    identity: NewIdentity,
    { verifiedAt, clearPassword }: LinkIdentityOptions,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(userIdentities).values({ id: newId(), userId, ...identity });
      await tx
        .update(users)
        .set({
          emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${verifiedAt.toISOString()}::timestamptz)`,
          ...(clearPassword ? { passwordHash: null } : {}),
        })
        .where(eq(users.id, userId));
    });
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  }

  async listMemberships(userId: string): Promise<Membership[]> {
    return this.db
      .select({
        accountId: accountMembers.accountId,
        accountName: accounts.name,
        accountType: accounts.type,
        role: accountMembers.role,
      })
      .from(accountMembers)
      .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
      .where(eq(accountMembers.userId, userId))
      .orderBy(asc(accountMembers.createdAt), asc(accountMembers.accountId));
  }
}
