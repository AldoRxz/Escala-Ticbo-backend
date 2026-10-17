import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Transaction } from '../../../shared/infrastructure/database/database.tokens.js';
import { isUniqueViolation } from '../../../shared/infrastructure/database/pg-errors.js';
import {
  fiscalProfiles,
  merchants,
  receipts,
} from '../../../shared/infrastructure/database/schema/index.js';
import { TenantDatabase } from '../../../shared/infrastructure/database/tenant-database.js';
import type {
  NewReceipt,
  ReceiptPage,
  ReceiptRepository,
} from '../application/ports/receipt.repository.js';
import type { Receipt, ReceiptSource } from '../domain/receipt.js';

const columns = {
  receipt: receipts,
  receiverRfc: fiscalProfiles.rfc,
  receiverName: fiscalProfiles.legalName,
  merchantName: merchants.name,
};

type Row = {
  receipt: typeof receipts.$inferSelect;
  receiverRfc: string | null;
  receiverName: string | null;
  merchantName: string | null;
};

function toReceipt({ receipt, receiverRfc, receiverName, merchantName }: Row): Receipt {
  return {
    id: receipt.id,
    accountId: receipt.accountId,
    source: receipt.source,
    status: receipt.status,
    imageObjectKey: receipt.imageObjectKey,
    receiver:
      receipt.fiscalProfileId && receiverRfc && receiverName
        ? { id: receipt.fiscalProfileId, rfc: receiverRfc, legalName: receiverName }
        : null,
    cfdiUse: receipt.cfdiUse,
    senderPhone: receipt.senderPhone,
    senderLabel: receipt.senderLabel,
    merchantName,
    total: receipt.total,
    purchasedAt: receipt.purchasedAt,
    createdAt: receipt.createdAt,
  };
}

function withDetails(tx: Transaction) {
  return tx
    .select(columns)
    .from(receipts)
    .leftJoin(fiscalProfiles, eq(fiscalProfiles.id, receipts.fiscalProfileId))
    .leftJoin(merchants, eq(merchants.id, receipts.merchantId));
}

// Every query runs inside TenantDatabase.run: row-level security confines it to the account.
@Injectable()
export class DrizzleReceiptRepository implements ReceiptRepository {
  constructor(private readonly tenants: TenantDatabase) {}

  async findBySourceMessage(
    accountId: string,
    source: ReceiptSource,
    sourceMessageId: string,
  ): Promise<Receipt | null> {
    const [row] = await this.tenants.run(accountId, (tx) =>
      withDetails(tx)
        .where(and(eq(receipts.source, source), eq(receipts.sourceMessageId, sourceMessageId)))
        .limit(1),
    );
    return row ? toReceipt(row) : null;
  }

  async insert(receipt: NewReceipt): Promise<Receipt | null> {
    try {
      return await this.tenants.run(receipt.accountId, async (tx) => {
        // The sender's RFC, or the account's default one; its suggested CFDI use comes along.
        const [profile] = await tx
          .select({ id: fiscalProfiles.id, defaultCfdiUse: fiscalProfiles.defaultCfdiUse })
          .from(fiscalProfiles)
          .where(
            receipt.fiscalProfileId
              ? eq(fiscalProfiles.id, receipt.fiscalProfileId)
              : eq(fiscalProfiles.isDefault, true),
          )
          .limit(1);
        await tx.insert(receipts).values({
          id: receipt.id,
          accountId: receipt.accountId,
          source: receipt.source,
          sourceMessageId: receipt.sourceMessageId,
          imageObjectKey: receipt.imageObjectKey,
          fiscalProfileId: profile?.id ?? null,
          cfdiUse: profile?.defaultCfdiUse ?? null,
          senderPhone: receipt.senderPhone,
          senderLabel: receipt.senderLabel,
        });
        const [row] = await withDetails(tx).where(eq(receipts.id, receipt.id));
        return toReceipt(row!);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'receipts_account_source_message_key')) {
        return null;
      }
      throw error;
    }
  }

  async list(accountId: string, limit: number, before?: string): Promise<ReceiptPage> {
    const rows = await this.tenants.run(accountId, (tx) =>
      withDetails(tx)
        // Ids are UUIDv7: ordering by id is ordering by arrival.
        .where(before ? lt(receipts.id, before) : undefined)
        .orderBy(desc(receipts.id))
        .limit(limit + 1),
    );
    const items = rows.slice(0, limit).map(toReceipt);
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  }

  async find(accountId: string, id: string): Promise<Receipt | null> {
    const [row] = await this.tenants.run(accountId, (tx) =>
      withDetails(tx).where(eq(receipts.id, id)).limit(1),
    );
    return row ? toReceipt(row) : null;
  }
}
