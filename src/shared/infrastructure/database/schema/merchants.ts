import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, updatedAt } from './columns.js';

// Global catalog shared by every tenant (no account_id): which invoicing portal
// serves each merchant and which automation adapter knows how to fill it.

export const merchantPortalStatus = pgEnum('merchant_portal_status', [
  'active',
  'degraded',
  'unsupported',
]);

export const merchants = pgTable(
  'merchants',
  {
    id: primaryId(),
    name: varchar('name', { length: 200 }).notNull(),
    // Issuer RFC printed on the ticket; null while a merchant is only known by brand
    rfc: varchar('rfc', { length: 13 }),
    portalUrl: text('portal_url'),
    // Portal automation adapter, e.g. "starbucks-mx"
    adapterKey: varchar('adapter_key', { length: 64 }),
    // Ticket fields the portal asks for, e.g. ["ticket_folio", "store_id", "total"]
    ticketFields: jsonb('ticket_fields')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Days after purchase the portal still accepts the ticket; null when unknown
    invoiceWindowDays: integer('invoice_window_days'),
    status: merchantPortalStatus('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('merchants_rfc_key').on(t.rfc)],
);
