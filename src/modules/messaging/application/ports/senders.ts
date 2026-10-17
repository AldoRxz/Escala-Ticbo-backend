/** Fields of an authorized sender the account can change; undefined keeps the value. */
export interface SenderChanges {
  label?: string | null;
  defaultFiscalProfileId?: string | null;
}

/** Signals a default RFC that does not exist in the account. */
export class UnknownFiscalProfileError extends Error {}
