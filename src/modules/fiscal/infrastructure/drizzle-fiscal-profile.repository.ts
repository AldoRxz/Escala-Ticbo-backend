import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import type { Transaction } from '../../../shared/infrastructure/database/database.tokens.js';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../../../shared/infrastructure/database/pg-errors.js';
import { fiscalProfiles } from '../../../shared/infrastructure/database/schema/index.js';
import { TenantDatabase } from '../../../shared/infrastructure/database/tenant-database.js';
import { FiscalProfileInUseError, FiscalProfileRfcTakenError } from '../application/errors.js';
import {
  type FiscalProfileChanges,
  type FiscalProfileRepository,
  InvoiceEmailTakenError,
  type NewFiscalProfile,
} from '../application/ports/fiscal-profile.repository.js';
import type { FiscalProfile } from '../domain/fiscal-profile.js';

type Row = typeof fiscalProfiles.$inferSelect;

function toProfile(row: Row): FiscalProfile {
  return {
    id: row.id,
    accountId: row.accountId,
    rfc: row.rfc,
    legalName: row.legalName,
    taxRegime: row.taxRegime,
    postalCode: row.postalCode,
    defaultCfdiUse: row.defaultCfdiUse,
    invoiceEmail: row.invoiceEmail,
    isDefault: row.isDefault,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
  };
}

// Every query runs inside TenantDatabase.run: row-level security confines it to
// the account even if an id from another account is passed in.
@Injectable()
export class DrizzleFiscalProfileRepository implements FiscalProfileRepository {
  constructor(private readonly tenants: TenantDatabase) {}

  async list(accountId: string): Promise<FiscalProfile[]> {
    const rows = await this.tenants.run(accountId, (tx) =>
      tx
        .select()
        .from(fiscalProfiles)
        .orderBy(desc(fiscalProfiles.isDefault), asc(fiscalProfiles.createdAt)),
    );
    return rows.map(toProfile);
  }

  async find(accountId: string, id: string): Promise<FiscalProfile | null> {
    const [row] = await this.tenants.run(accountId, (tx) => byId(tx, id));
    return row ? toProfile(row) : null;
  }

  async insert(profile: NewFiscalProfile): Promise<FiscalProfile> {
    try {
      const [row] = await this.tenants.run(profile.accountId, async (tx) => {
        const [existing] = await tx.select({ id: fiscalProfiles.id }).from(fiscalProfiles).limit(1);
        return tx
          .insert(fiscalProfiles)
          .values({ ...profile, isDefault: !existing })
          .returning();
      });
      return toProfile(row!);
    } catch (error) {
      if (isUniqueViolation(error, 'fiscal_profiles_account_rfc_key')) {
        throw new FiscalProfileRfcTakenError();
      }
      if (isUniqueViolation(error, 'fiscal_profiles_invoice_email_key')) {
        throw new InvoiceEmailTakenError();
      }
      throw error;
    }
  }

  async update(
    accountId: string,
    id: string,
    changes: FiscalProfileChanges,
  ): Promise<FiscalProfile | null> {
    const [row] = await this.tenants.run(accountId, (tx) =>
      tx.update(fiscalProfiles).set(changes).where(eq(fiscalProfiles.id, id)).returning(),
    );
    return row ? toProfile(row) : null;
  }

  async makeDefault(accountId: string, id: string): Promise<FiscalProfile | null> {
    const [row] = await this.tenants.run(accountId, async (tx) => {
      const [target] = await byId(tx, id);
      if (!target) {
        return [];
      }
      // Clear the current default first: a partial unique index allows only one.
      await tx
        .update(fiscalProfiles)
        .set({ isDefault: false })
        .where(and(eq(fiscalProfiles.isDefault, true), ne(fiscalProfiles.id, id)));
      return tx
        .update(fiscalProfiles)
        .set({ isDefault: true })
        .where(eq(fiscalProfiles.id, id))
        .returning();
    });
    return row ? toProfile(row) : null;
  }

  async delete(accountId: string, id: string): Promise<boolean> {
    try {
      return await this.tenants.run(accountId, async (tx) => {
        const [deleted] = await tx
          .delete(fiscalProfiles)
          .where(eq(fiscalProfiles.id, id))
          .returning({ isDefault: fiscalProfiles.isDefault });
        if (!deleted) {
          return false;
        }
        if (deleted.isDefault) {
          const [oldest] = await tx
            .select({ id: fiscalProfiles.id })
            .from(fiscalProfiles)
            .orderBy(asc(fiscalProfiles.createdAt))
            .limit(1);
          if (oldest) {
            await tx
              .update(fiscalProfiles)
              .set({ isDefault: true })
              .where(eq(fiscalProfiles.id, oldest.id));
          }
        }
        return true;
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new FiscalProfileInUseError();
      }
      throw error;
    }
  }
}

function byId(tx: Transaction, id: string) {
  return tx.select().from(fiscalProfiles).where(eq(fiscalProfiles.id, id)).limit(1);
}
