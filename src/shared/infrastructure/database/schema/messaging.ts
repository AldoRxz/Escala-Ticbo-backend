import {
  bigint,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
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
    // Who this phone belongs to, as the account names it ("Juan · ventas")
    label: varchar('label', { length: 80 }),
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

export const telegramBotStatus = pgEnum('telegram_bot_status', ['active', 'disabled']);

/**
 * A Telegram bot the customer created with @BotFather. Ticbo registers its
 * webhook itself, so there is nothing to paste back into Telegram.
 */
export const telegramBots = pgTable(
  'telegram_bots',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    // Telegram's numeric id of the bot (the part of the token before the colon)
    botUserId: bigint('bot_user_id', { mode: 'number' }).notNull(),
    username: varchar('username', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 128 }).notNull(),
    tokenSecretId: uuid('token_secret_id').notNull(),
    // SHA-256 of the secret Telegram sends in X-Telegram-Bot-Api-Secret-Token
    webhookSecretHash: varchar('webhook_secret_hash', { length: 64 }).notNull(),
    status: telegramBotStatus('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('telegram_bots_bot_user_id_key').on(t.botUserId),
    index('telegram_bots_account_id_idx').on(t.accountId),
    foreignKey({
      name: 'telegram_bots_token_fk',
      columns: [t.tokenSecretId, t.accountId],
      foreignColumns: [encryptedSecrets.id, encryptedSecrets.accountId],
    }).onDelete('restrict'),
  ],
);

/**
 * A phone allowed to send receipts to a bot. Telegram does not reveal phone
 * numbers, so the person shares their contact with the bot once and that links
 * their Telegram user to this row.
 */
export const telegramSenders = pgTable(
  'telegram_senders',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    botId: uuid('bot_id')
      .notNull()
      .references(() => telegramBots.id, { onDelete: 'cascade' }),
    // Country code and number, digits only
    phone: varchar('phone', { length: 20 }).notNull(),
    label: varchar('label', { length: 80 }),
    defaultFiscalProfileId: uuid('default_fiscal_profile_id'),
    // Set when the person shares their own contact with the bot
    telegramUserId: bigint('telegram_user_id', { mode: 'number' }),
    linkedAt: timestamptz('linked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('telegram_senders_bot_phone_key').on(t.botId, t.phone),
    uniqueIndex('telegram_senders_bot_user_key').on(t.botId, t.telegramUserId),
    index('telegram_senders_account_id_idx').on(t.accountId),
    foreignKey({
      name: 'telegram_senders_default_profile_fk',
      columns: [t.defaultFiscalProfileId, t.accountId],
      foreignColumns: [fiscalProfiles.id, fiscalProfiles.accountId],
    }).onDelete('restrict'),
  ],
);
