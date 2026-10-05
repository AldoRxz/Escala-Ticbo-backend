import { index, pgEnum, pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { bytea, createdAt, primaryId, timestamptz } from './columns.js';
import { accounts } from './iam.js';

// Tenant data (row-level security). Envelope encryption: each payload is sealed
// with its own random data key (AES-256-GCM) and that data key is wrapped by a
// key-encryption key held in a KMS. The database never stores a usable key.

export const secretKind = pgEnum('secret_kind', [
  'whatsapp_access_token',
  'whatsapp_app_secret',
  'fiel_private_key',
  'fiel_password',
  'csd_private_key',
  'csd_password',
]);

export const encryptedSecrets = pgTable(
  'encrypted_secrets',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: secretKind('kind').notNull(),
    // iv (12 bytes) || auth tag (16 bytes) || ciphertext
    ciphertext: bytea('ciphertext').notNull(),
    wrappedDataKey: bytea('wrapped_data_key').notNull(),
    // Key-encryption key that wrapped the data key (KMS key ARN or local key version).
    keyId: varchar('key_id', { length: 256 }).notNull(),
    algorithm: varchar('algorithm', { length: 32 }).notNull().default('AES-256-GCM'),
    createdAt: createdAt(),
    rotatedAt: timestamptz('rotated_at'),
  },
  (t) => [
    unique('encrypted_secrets_id_account_key').on(t.id, t.accountId),
    index('encrypted_secrets_account_id_idx').on(t.accountId),
    index('encrypted_secrets_key_id_idx').on(t.keyId),
  ],
);
