import { AppError } from '../../../shared/domain/app-error.js';

export class ReceiptNotFoundError extends AppError {
  override readonly code = 'receipt_not_found';
  override readonly category = 'not_found';

  constructor() {
    super('The receipt does not exist in this account.');
  }
}

export class UnsupportedReceiptImageError extends AppError {
  override readonly code = 'unsupported_receipt_image';
  override readonly category = 'invalid_input';

  constructor() {
    super('Send the ticket as a JPEG, PNG or WebP photo.');
  }
}

export class ReceiptImageTooLargeError extends AppError {
  override readonly code = 'receipt_image_too_large';
  override readonly category = 'invalid_input';

  constructor() {
    super('The photo is larger than 4 MB.');
  }
}
