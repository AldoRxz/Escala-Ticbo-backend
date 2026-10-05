import type { User } from './user.js';

export type OAuthProviderName = 'google' | 'facebook';

/** Identity asserted by an OAuth/OpenID Connect provider after a successful sign-in. */
export interface OAuthProfile {
  readonly provider: OAuthProviderName;
  /** Stable user id at the provider (`sub`). Emails can change; this cannot. */
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly fullName: string;
  readonly avatarUrl: string | null;
}

export type OAuthLinkDecision = 'link' | 'link_and_reset_credentials';

/**
 * What to do when a verified provider email matches an existing user who has
 * never used that provider.
 *
 * If the existing user never verified their email, someone else may have
 * registered it first to hijack the account later ("pre-account takeover"). The
 * provider has just proven who owns the address, so the identity is linked and
 * the unverified password and sessions are discarded.
 */
export function decideOAuthLink(
  existing: Pick<User, 'emailVerifiedAt' | 'passwordHash'>,
): OAuthLinkDecision {
  if (existing.emailVerifiedAt === null && existing.passwordHash !== null) {
    return 'link_and_reset_credentials';
  }
  return 'link';
}
