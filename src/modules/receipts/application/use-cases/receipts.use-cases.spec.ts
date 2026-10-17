import { describe, expect, it } from 'vitest';
import {
  ObjectStorage,
  StorageNotConfiguredError,
  type StoredObject,
} from '../../../../shared/application/object-storage.js';
import type { Receipt, ReceiptSource } from '../../domain/receipt.js';
import { ReceiptImageTooLargeError, UnsupportedReceiptImageError } from '../errors.js';
import type { NewReceipt, ReceiptPage, ReceiptRepository } from '../ports/receipt.repository.js';
import { IngestReceiptUseCase } from './receipts.use-cases.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

class MemoryStorage extends ObjectStorage {
  readonly objects = new Map<string, StoredObject>();

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<StoredObject | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

/** Receipts in memory; `raceWith` makes the next insert lose to a concurrent retry. */
class MemoryReceipts implements ReceiptRepository {
  readonly receipts: Receipt[] = [];
  raceWith: Receipt | null = null;

  findBySourceMessage(_accountId: string, source: ReceiptSource, messageId: string) {
    const found = this.receipts.find((r) => r.source === source && r.id === `msg:${messageId}`);
    return Promise.resolve(found ?? null);
  }

  insert(receipt: NewReceipt): Promise<Receipt | null> {
    if (this.raceWith) {
      this.receipts.push(this.raceWith);
      this.raceWith = null;
      return Promise.resolve(null);
    }
    const stored = receiptOf(receipt.sourceMessageId, receipt.imageObjectKey);
    this.receipts.push(stored);
    return Promise.resolve(stored);
  }

  list(): Promise<ReceiptPage> {
    return Promise.resolve({ items: this.receipts, nextCursor: null });
  }

  find(): Promise<Receipt | null> {
    return Promise.resolve(null);
  }
}

function receiptOf(messageId: string, imageObjectKey: string): Receipt {
  return {
    id: `msg:${messageId}`,
    accountId: 'acc-1',
    source: 'telegram',
    status: 'received',
    imageObjectKey,
    receiver: null,
    cfdiUse: null,
    senderPhone: null,
    senderLabel: null,
    merchantName: null,
    total: null,
    purchasedAt: null,
    createdAt: new Date(),
  };
}

const incoming = (image: Buffer = JPEG) => ({
  accountId: 'acc-1',
  source: 'telegram' as const,
  sourceMessageId: '1:2:3',
  image,
  fiscalProfileId: null,
  senderPhone: '525512345678',
  senderLabel: 'Juan',
});

describe('IngestReceiptUseCase', () => {
  it('stores the photo under the account and opens the receipt', async () => {
    const storage = new MemoryStorage();
    const receipts = new MemoryReceipts();

    const { receipt, duplicate } = await new IngestReceiptUseCase(receipts, storage).execute(
      incoming(),
    );

    expect(duplicate).toBe(false);
    expect(receipt.imageObjectKey).toMatch(/^accounts\/acc-1\/receipts\/[0-9a-f-]{36}\.jpg$/);
    expect(storage.objects.get(receipt.imageObjectKey)).toEqual({
      body: JPEG,
      contentType: 'image/jpeg',
    });
  });

  it('keeps one receipt and one photo when a retry wins the race', async () => {
    const storage = new MemoryStorage();
    const receipts = new MemoryReceipts();
    receipts.raceWith = receiptOf('1:2:3', 'accounts/acc-1/receipts/winner.jpg');

    const { receipt, duplicate } = await new IngestReceiptUseCase(receipts, storage).execute(
      incoming(),
    );

    expect(duplicate).toBe(true);
    expect(receipt.imageObjectKey).toBe('accounts/acc-1/receipts/winner.jpg');
    expect(storage.objects.size).toBe(0);
  });

  it('refuses files that are not photos or are too large, before storing anything', async () => {
    const storage = new MemoryStorage();
    const ingest = new IngestReceiptUseCase(new MemoryReceipts(), storage);

    await expect(ingest.execute(incoming(Buffer.from('%PDF-1.7')))).rejects.toBeInstanceOf(
      UnsupportedReceiptImageError,
    );
    const huge = Buffer.concat([JPEG, Buffer.alloc(4 * 1024 * 1024)]);
    await expect(ingest.execute(incoming(huge))).rejects.toBeInstanceOf(ReceiptImageTooLargeError);
    expect(storage.objects.size).toBe(0);
  });

  it('fails clearly while no storage is configured', async () => {
    const storage = new MemoryStorage();
    storage.put = () => Promise.reject(new StorageNotConfiguredError());
    const receipts = new MemoryReceipts();

    await expect(
      new IngestReceiptUseCase(receipts, storage).execute(incoming()),
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
    expect(receipts.receipts).toEqual([]);
  });
});
