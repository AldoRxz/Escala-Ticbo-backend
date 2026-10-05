import {
  char,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import { fiscalProfiles } from './fiscal.js';
import { accounts } from './iam.js';
import { receipts } from './receipts.js';

// Tenant data (row-level security). The CFDI is issued by the merchant through its
// PAC; Ticbo stores what came back and keeps checking it against the SAT.

export const cfdiSatStatus = pgEnum('cfdi_sat_status', ['unknown', 'active', 'cancelled']);
export const efosStatus = pgEnum('efos_status', ['unknown', 'clear', 'listed']);

export const invoices = pgTable(
  'invoices',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    receiptId: uuid('receipt_id'),
    fiscalProfileId: uuid('fiscal_profile_id').notNull(),
    // Folio fiscal (TimbreFiscalDigital UUID)
    cfdiUuid: uuid('cfdi_uuid').notNull(),
    issuerRfc: varchar('issuer_rfc', { length: 13 }).notNull(),
    issuerName: varchar('issuer_name', { length: 300 }),
    receiverRfc: varchar('receiver_rfc', { length: 13 }).notNull(),
    issuedAt: timestamptz('issued_at').notNull(),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }),
    total: numeric('total', { precision: 14, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('MXN'),
    cfdiUse: varchar('cfdi_use', { length: 4 }),
    xmlObjectKey: text('xml_object_key').notNull(),
    pdfObjectKey: text('pdf_object_key'),
    satStatus: cfdiSatStatus('sat_status').notNull().default('unknown'),
    satCheckedAt: timestamptz('sat_checked_at'),
    // Issuer against the SAT article 69-B list (EFOS)
    issuerEfosStatus: efosStatus('issuer_efos_status').notNull().default('unknown'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('invoices_account_cfdi_uuid_key').on(t.accountId, t.cfdiUuid),
    uniqueIndex('invoices_receipt_id_key').on(t.receiptId),
    index('invoices_account_issued_idx').on(t.accountId, t.issuedAt.desc()),
    index('invoices_account_profile_idx').on(t.accountId, t.fiscalProfileId),
    foreignKey({
      name: 'invoices_receipt_fk',
      columns: [t.receiptId, t.accountId],
      foreignColumns: [receipts.id, receipts.accountId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'invoices_fiscal_profile_fk',
      columns: [t.fiscalProfileId, t.accountId],
      foreignColumns: [fiscalProfiles.id, fiscalProfiles.accountId],
    }).onDelete('restrict'),
  ],
);
