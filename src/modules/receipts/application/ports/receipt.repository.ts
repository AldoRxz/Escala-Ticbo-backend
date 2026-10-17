import type { Receipt, ReceiptSource } from '../../domain/receipt.js';

export interface NewReceipt {
  id: string;
  accountId: string;
  source: ReceiptSource;
  sourceMessageId: string;
  imageObjectKey: string;
  /** Null: the account's default RFC, if it has one. */
  fiscalProfileId: string | null;
  senderPhone: string | null;
  senderLabel: string | null;
}

export interface ReceiptPage {
  items: Receipt[];
  /** Pass as `before` for the next page; null on the last one. */
  nextCursor: string | null;
}

/** Receipts of one account (row-level security applies). */
export abstract class ReceiptRepository {
  abstract findBySourceMessage(
    accountId: string,
    source: ReceiptSource,
    sourceMessageId: string,
  ): Promise<Receipt | null>;

  /**
   * Saves the receipt with the RFC it goes to and that RFC's suggested CFDI use.
   * Null when a receipt for the same message already exists (a webhook retry).
   */
  abstract insert(receipt: NewReceipt): Promise<Receipt | null>;

  /** Newest first. */
  abstract list(accountId: string, limit: number, before?: string): Promise<ReceiptPage>;

  abstract find(accountId: string, id: string): Promise<Receipt | null>;
}
