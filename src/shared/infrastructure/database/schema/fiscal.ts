import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import { accounts } from './iam.js';
import { encryptedSecrets } from './vault.js';

// Tenant data (row-level security). Foreign keys between tenant tables include
// account_id so a row can never point at another tenant's data: Postgres checks
// foreign keys without applying RLS.

export const fiscalCredentialKind = pgEnum('fiscal_credential_kind', ['fiel', 'csd']);

/** Receiver (receptor) data that merchants' invoicing portals ask for. */
export const fiscalProfiles = pgTable(
  'fiscal_profiles',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    rfc: varchar('rfc', { length: 13 }).notNull(),
    legalName: varchar('legal_name', { length: 300 }).notNull(),
    // c_RegimenFiscal (e.g. 601, 612, 626)
    taxRegime: char('tax_regime', { length: 3 }).notNull(),
    // DomicilioFiscalReceptor
    postalCode: char('postal_code', { length: 5 }).notNull(),
    // c_UsoCFDI used when the receipt does not call for another one
    defaultCfdiUse: varchar('default_cfdi_use', { length: 4 }).notNull().default('G03'),
    // Ticbo inbox typed into merchant portals, so the CFDI XML/PDF arrives to us
    invoiceEmail: varchar('invoice_email', { length: 254 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    // Set once the data matches the Constancia de Situación Fiscal
    verifiedAt: timestamptz('verified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('fiscal_profiles_id_account_key').on(t.id, t.accountId),
    uniqueIndex('fiscal_profiles_account_rfc_key').on(t.accountId, t.rfc),
    uniqueIndex('fiscal_profiles_account_default_key')
      .on(t.accountId)
      .where(sql`is_default`),
    uniqueIndex('fiscal_profiles_invoice_email_key').on(t.invoiceEmail),
    check('fiscal_profiles_rfc_format', sql`${t.rfc} ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'`),
    check('fiscal_profiles_postal_code_format', sql`${t.postalCode} ~ '^[0-9]{5}$'`),
  ],
);

/** e.firma (FIEL) or CSD. The certificate is public; key and password live in the vault. */
export const fiscalCredentials = pgTable(
  'fiscal_credentials',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    fiscalProfileId: uuid('fiscal_profile_id').notNull(),
    kind: fiscalCredentialKind('kind').notNull(),
    certificateNumber: varchar('certificate_number', { length: 20 }).notNull(),
    certificate: text('certificate').notNull(),
    validFrom: timestamptz('valid_from').notNull(),
    validUntil: timestamptz('valid_until').notNull(),
    privateKeySecretId: uuid('private_key_secret_id').notNull(),
    passwordSecretId: uuid('password_secret_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('fiscal_credentials_profile_kind_number_key').on(
      t.fiscalProfileId,
      t.kind,
      t.certificateNumber,
    ),
    index('fiscal_credentials_account_id_idx').on(t.accountId),
    foreignKey({
      name: 'fiscal_credentials_profile_fk',
      columns: [t.fiscalProfileId, t.accountId],
      foreignColumns: [fiscalProfiles.id, fiscalProfiles.accountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fiscal_credentials_private_key_fk',
      columns: [t.privateKeySecretId, t.accountId],
      foreignColumns: [encryptedSecrets.id, encryptedSecrets.accountId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fiscal_credentials_password_fk',
      columns: [t.passwordSecretId, t.accountId],
      foreignColumns: [encryptedSecrets.id, encryptedSecrets.accountId],
    }).onDelete('restrict'),
  ],
);
