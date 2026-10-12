import type { FiscalData, FiscalProfile } from '../../domain/fiscal-profile.js';

export interface NewFiscalProfile extends FiscalData {
  id: string;
  accountId: string;
  invoiceEmail: string;
}

export type FiscalProfileChanges = Omit<FiscalData, 'rfc'>;

/** Another profile already has the generated inbox alias; the caller retries with a new one. */
export class InvoiceEmailTakenError extends Error {}

/** Fiscal profiles of one account. Every method is scoped to `accountId`. */
export abstract class FiscalProfileRepository {
  /** The default profile first, then by age. */
  abstract list(accountId: string): Promise<FiscalProfile[]>;

  abstract find(accountId: string, id: string): Promise<FiscalProfile | null>;

  /**
   * Stores a new profile; the account's first one becomes its default.
   * @throws FiscalProfileRfcTakenError, InvoiceEmailTakenError
   */
  abstract insert(profile: NewFiscalProfile): Promise<FiscalProfile>;

  /** Null when the profile does not exist in the account. */
  abstract update(
    accountId: string,
    id: string,
    changes: FiscalProfileChanges,
  ): Promise<FiscalProfile | null>;

  /** Makes `id` the account's default profile. Null when it does not exist. */
  abstract makeDefault(accountId: string, id: string): Promise<FiscalProfile | null>;

  /**
   * Deletes the profile; if it was the default, the oldest remaining one takes over.
   * Returns false when it does not exist.
   * @throws FiscalProfileInUseError
   */
  abstract delete(accountId: string, id: string): Promise<boolean>;
}
