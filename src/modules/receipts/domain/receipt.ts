export type ReceiptSource = 'whatsapp' | 'telegram' | 'web' | 'email';

/** Pipeline state of a ticket, from the photo to the CFDI. */
export type ReceiptStatus =
  | 'received'
  | 'extracting'
  | 'requesting_invoice'
  | 'awaiting_cfdi'
  | 'invoiced'
  | 'needs_review'
  | 'failed';

/** The RFC a receipt is invoiced to. */
export interface ReceiptReceiver {
  readonly id: string;
  readonly rfc: string;
  readonly legalName: string;
}

/** A ticket someone sent to be invoiced. */
export interface Receipt {
  readonly id: string;
  readonly accountId: string;
  readonly source: ReceiptSource;
  readonly status: ReceiptStatus;
  readonly imageObjectKey: string;
  readonly receiver: ReceiptReceiver | null;
  readonly cfdiUse: string | null;
  readonly senderPhone: string | null;
  readonly senderLabel: string | null;
  readonly merchantName: string | null;
  readonly total: string | null;
  readonly purchasedAt: Date | null;
  readonly createdAt: Date;
}

export type ImageType = { extension: 'jpg' | 'png' | 'webp'; contentType: string };

/**
 * The image format from the file's first bytes, never from what the sender
 * claims. Null for anything that is not a JPEG, PNG or WebP photo.
 */
export function detectImageType(bytes: Buffer): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { extension: 'png', contentType: 'image/png' };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { extension: 'webp', contentType: 'image/webp' };
  }
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Largest photo accepted: it must also fit back through the API (Lambda answers up to 6 MB). */
export const MAX_RECEIPT_IMAGE_BYTES = 4 * 1024 * 1024;

/** Where a receipt's photo lives: under its account, so an account's files can be exported or erased. */
export function receiptImageKey(accountId: string, receiptId: string, image: ImageType): string {
  return `accounts/${accountId}/receipts/${receiptId}.${image.extension}`;
}
