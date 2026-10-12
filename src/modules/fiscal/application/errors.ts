import { AppError } from '../../../shared/domain/app-error.js';

export class FiscalProfileNotFoundError extends AppError {
  override readonly code = 'fiscal_profile_not_found';
  override readonly category = 'not_found';

  constructor() {
    super('The fiscal profile does not exist in this account.');
  }
}

export class FiscalProfileRfcTakenError extends AppError {
  override readonly code = 'fiscal_profile_rfc_taken';
  override readonly category = 'conflict';

  constructor() {
    super('This account already has a fiscal profile with that RFC.');
  }
}

export class FiscalProfileInUseError extends AppError {
  override readonly code = 'fiscal_profile_in_use';
  override readonly category = 'conflict';

  constructor() {
    super('Receipts, invoices or WhatsApp senders still use this fiscal profile.');
  }
}
