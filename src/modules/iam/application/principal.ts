import type { MemberRole } from '../domain/user.js';

/** The authenticated caller, as carried by a verified access token. */
export interface Principal {
  readonly userId: string;
  /** Refresh-token family the access token was issued from. */
  readonly sessionId: string;
  /** Active tenant account; null only if the user belongs to no account. */
  readonly accountId: string | null;
  readonly role: MemberRole | null;
}

/** Where a sign-in or refresh request came from, recorded on the session. */
export interface ClientContext {
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}
