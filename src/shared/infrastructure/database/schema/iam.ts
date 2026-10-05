import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';

// Control plane: identity, sessions and tenants. These tables are read before a
// tenant is known (login, token refresh), so they are not under row-level security.

export const oauthProvider = pgEnum('oauth_provider', ['google', 'facebook']);
export const accountType = pgEnum('account_type', ['personal', 'organization']);
export const memberRole = pgEnum('member_role', ['owner', 'admin', 'member', 'viewer']);

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: varchar('email', { length: 254 }).notNull(),
    emailVerifiedAt: timestamptz('email_verified_at'),
    // Null for users created through an OAuth provider.
    passwordHash: text('password_hash'),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    avatarUrl: text('avatar_url'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
  ],
);

export const userIdentities = pgTable(
  'user_identities',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: oauthProvider('provider').notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('user_identities_provider_subject_key').on(t.provider, t.subject),
    index('user_identities_user_id_idx').on(t.userId),
  ],
);

/**
 * Opaque refresh tokens, stored as SHA-256 hashes. Every rotation creates a new
 * row in the same family; presenting an already rotated token revokes the family.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    replacedById: uuid('replaced_by_id'),
    userAgent: varchar('user_agent', { length: 512 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_key').on(t.tokenHash),
    index('refresh_tokens_family_id_idx').on(t.familyId),
    index('refresh_tokens_user_id_idx').on(t.userId),
    index('refresh_tokens_expires_at_idx').on(t.expiresAt),
  ],
);

/** The tenant. A user gets a personal account on sign-up and can join organization accounts. */
export const accounts = pgTable('accounts', {
  id: primaryId(),
  name: varchar('name', { length: 160 }).notNull(),
  type: accountType('type').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const accountMembers = pgTable(
  'account_members',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.userId] }),
    index('account_members_user_id_idx').on(t.userId),
  ],
);
