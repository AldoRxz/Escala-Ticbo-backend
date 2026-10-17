import { Injectable, Logger } from '@nestjs/common';
import { ObjectStorage, type StoredObject } from '../../../../shared/application/object-storage.js';
import { newId } from '../../../../shared/domain/id.js';
import { activeAccountOf } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import {
  detectImageType,
  MAX_RECEIPT_IMAGE_BYTES,
  type Receipt,
  type ReceiptSource,
  receiptImageKey,
} from '../../domain/receipt.js';
import {
  ReceiptImageTooLargeError,
  ReceiptNotFoundError,
  UnsupportedReceiptImageError,
} from '../errors.js';
import { type ReceiptPage, ReceiptRepository } from '../ports/receipt.repository.js';

export interface IncomingReceipt {
  accountId: string;
  source: ReceiptSource;
  /** The chat message's id: a retried webhook does not create a second receipt. */
  sourceMessageId: string;
  image: Buffer;
  /** The sender's RFC; null uses the account's default. */
  fiscalProfileId: string | null;
  senderPhone: string | null;
  senderLabel: string | null;
}

export interface IngestedReceipt {
  receipt: Receipt;
  /** True when the message had already been received. */
  duplicate: boolean;
}

/**
 * First step of the pipeline: keeps the photo in storage and opens the receipt
 * in `received`. Called by the chat webhooks once they know the account.
 */
@Injectable()
export class IngestReceiptUseCase {
  private readonly logger = new Logger(IngestReceiptUseCase.name);

  constructor(
    private readonly receipts: ReceiptRepository,
    private readonly storage: ObjectStorage,
  ) {}

  /** A message already turned into a receipt (a retried webhook), or null. */
  received(accountId: string, source: ReceiptSource, sourceMessageId: string) {
    return this.receipts.findBySourceMessage(accountId, source, sourceMessageId);
  }

  /**
   * @throws UnsupportedReceiptImageError, ReceiptImageTooLargeError,
   *   StorageNotConfiguredError, StorageUnavailableError
   */
  async execute(input: IncomingReceipt): Promise<IngestedReceipt> {
    const existing = await this.received(input.accountId, input.source, input.sourceMessageId);
    if (existing) {
      return { receipt: existing, duplicate: true };
    }
    if (input.image.length > MAX_RECEIPT_IMAGE_BYTES) {
      throw new ReceiptImageTooLargeError();
    }
    const type = detectImageType(input.image);
    if (!type) {
      throw new UnsupportedReceiptImageError();
    }

    const id = newId();
    const key = receiptImageKey(input.accountId, id, type);
    await this.storage.put(key, input.image, type.contentType);
    const receipt = await this.receipts.insert({
      id,
      accountId: input.accountId,
      source: input.source,
      sourceMessageId: input.sourceMessageId,
      imageObjectKey: key,
      fiscalProfileId: input.fiscalProfileId,
      senderPhone: input.senderPhone,
      senderLabel: input.senderLabel,
    });
    if (receipt) {
      return { receipt, duplicate: false };
    }

    // A retry of the same message got there first: keep its receipt, drop this photo.
    await this.storage.delete(key).catch(() => {
      this.logger.warn(`Could not delete the duplicate photo ${key}`);
    });
    const winner = await this.received(input.accountId, input.source, input.sourceMessageId);
    return { receipt: winner!, duplicate: true };
  }
}

/** The account's receipts, newest first; any member can see them. */
@Injectable()
export class ListReceiptsUseCase {
  constructor(private readonly receipts: ReceiptRepository) {}

  async execute(
    principal: Principal,
    page: { limit: number; before?: string | undefined },
  ): Promise<ReceiptPage> {
    return this.receipts.list(activeAccountOf(principal), page.limit, page.before);
  }
}

/** The photo of one receipt of the account. */
@Injectable()
export class GetReceiptImageUseCase {
  constructor(
    private readonly receipts: ReceiptRepository,
    private readonly storage: ObjectStorage,
  ) {}

  /** @throws ReceiptNotFoundError, StorageNotConfiguredError, StorageUnavailableError */
  async execute(principal: Principal, id: string): Promise<StoredObject> {
    const receipt = await this.receipts.find(activeAccountOf(principal), id);
    const image = receipt ? await this.storage.get(receipt.imageObjectKey) : null;
    if (!image) {
      throw new ReceiptNotFoundError();
    }
    return image;
  }
}
