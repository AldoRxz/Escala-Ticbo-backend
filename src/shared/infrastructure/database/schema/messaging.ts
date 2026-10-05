import {
  foreignKey,
  index,
  pgEnum,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, updatedAt } from './columns.js';
import { fiscalProfiles } from './fiscal.js';
import { accounts, users } from './iam.js';
import { encryptedSecrets } from './vault.js';

// Control plane: a WhatsApp webhook only carries the phone_number_id and the
// sender's wa_id, so these routing tables are read before a tenant is known.
// They hold routing data only; credentials are referenced in the vault.

export const whatsappChannelStatus = pgEnum('whatsapp_channel_status', [
  'pending_verification',
  'active',
  'disabled',
]);

/**
 * A WhatsApp Business phone number connected through the Cloud API. Tenants bring
 * their own Meta credentials; a null account_id marks a shared Ticbo number whose
 * credentials come from the environment.
 */
export const whatsappChannels = pgTable(
  'whatsapp_channels',
  {
    id: primaryId(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    phoneNumberId: varchar('phone_number_id', { length: 32 }).notNull(),
    businessAccountId: varchar('business_account_id', { length: 32 }).notNull(),
    displayPhoneNumber: varchar('display_phone_number', { length: 20 }).notNull(),
    accessTokenSecretId: uuid('access_token_secret_id'),
    appSecretSecretId: uuid('app_secret_secret_id'),
    // SHA-256 of the token Meta echoes back when the webhook is registered
    verifyTokenHash: varchar('verify_token_hash', { length: 64 }),
    status: whatsappChannelStatus('status').notNull().default('pending_verification'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('whatsapp_channels_phone_number_id_key').on(t.phoneNumberId),
    index('whatsapp_channels_account_id_idx').on(t.accountId),
    foreignKey({
      name: 'whatsapp_channels_access_token_fk',
      columns: [t.accessTokenSecretId, t.accountId],
      foreignColumns: [encryptedSecrets.id, encryptedSecrets.accountId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'whatsapp_channels_app_secret_fk',
      columns: [t.appSecretSecretId, t.accountId],
      foreignColumns: [encryptedSecrets.id, encryptedSecrets.accountId],
    }).onDelete('restrict'),
  ],
);

/** A phone allowed to send receipts to a channel, mapped to a member and their default RFC. */
export const whatsappSenders = pgTable(
  'whatsapp_senders',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => whatsappChannels.id, { onDelete: 'cascade' }),
    // Sender phone as reported by WhatsApp (country code + number, digits only)
    waId: varchar('wa_id', { length: 20 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    defaultFiscalProfileId: uuid('default_fiscal_profile_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('whatsapp_senders_channel_wa_id_key').on(t.channelId, t.waId),
    index('whatsapp_senders_account_id_idx').on(t.accountId),
    foreignKey({
      name: 'whatsapp_senders_default_profile_fk',
      columns: [t.defaultFiscalProfileId, t.accountId],
      foreignColumns: [fiscalProfiles.id, fiscalProfiles.accountId],
    }).onDelete('restrict'),
  ],
);
