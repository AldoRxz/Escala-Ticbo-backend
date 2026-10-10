import { AppError } from '../../../shared/domain/app-error.js';

export class SecretNotFoundError extends AppError {
  override readonly code = 'secret_not_found';
  override readonly category = 'not_found';

  constructor() {
    super('The secret does not exist in this account.');
  }
}

/**
 * The ciphertext, its key or its context does not match: tampering, a row moved
 * between accounts, or a missing key-encryption key. Never an expected outcome,
 * so it is not an AppError and surfaces as a 500.
 */
export class SecretIntegrityError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Secret could not be decrypted: ${reason}`, options);
    this.name = 'SecretIntegrityError';
  }
}
