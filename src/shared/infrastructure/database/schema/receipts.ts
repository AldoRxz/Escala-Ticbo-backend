import {
  char,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import { fiscalProfiles } from './fiscal.js';
import { accounts, users } from './iam.js';
import { merchants } from './merchants.js';

// Tenant data (row-level security).

export const receiptSource = pgEnum('receipt_source', ['whatsapp', 'web', 'email']);

/** Pipeline state of a ticket, from the photo to the CFDI. */
export const receiptStatus = pgEnum('receipt_status', [
  'received',
  'extracting',
  'requesting_invoice',
  'awaiting_cfdi',
  'invoiced',
  'needs_review',
  'failed',
]);

export const receipts = pgTable(
  'receipts',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    fiscalProfileId: uuid('fiscal_profile_id'),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    source: receiptSource('source').notNull(),
    // WhatsApp message id: idempotency key for webhook retries
    sourceMessageId: varchar('source_message_id', { length: 128 }),
    status: receiptStatus('status').notNull().default('received'),
    imageObjectKey: text('image_object_key').notNull(),
    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    merchantRfc: varchar('merchant_rfc', { length: 13 }),
    ticketFolio: varchar('ticket_folio', { length: 64 }),
    purchasedAt: timestamptz('purchased_at'),
    total: numeric('total', { precision: 14, scale: 2 }),
    currency: char('currency', { length: 3 }).notNull().default('MXN'),
    cfdiUse: varchar('cfdi_use', { length: 4 }),
    // Raw OCR output with per-field confidence
    extraction: jsonb('extraction'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('receipts_id_account_key').on(t.id, t.accountId),
    uniqueIndex('receipts_account_source_message_key').on(
      t.accountId,
      t.source,
      t.sourceMessageId,
    ),
    index('receipts_account_created_idx').on(t.accountId, t.createdAt.desc()),
    index('receipts_account_status_idx').on(t.accountId, t.status),
    foreignKey({
      name: 'receipts_fiscal_profile_fk',
      columns: [t.fiscalProfileId, t.accountId],
      foreignColumns: [fiscalProfiles.id, fiscalProfiles.accountId],
    }).onDelete('restrict'),
  ],
);
