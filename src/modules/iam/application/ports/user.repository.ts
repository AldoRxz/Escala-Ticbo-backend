import type { Email } from '../../domain/email.js';
import type { OAuthProviderName } from '../../domain/oauth.js';
import type { Membership, User } from '../../domain/user.js';

export interface NewUser {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  avatarUrl: string | null;
}

export interface NewIdentity {
  provider: OAuthProviderName;
  subject: string;
  email: string;
}

export interface ProvisionUserInput {
  user: NewUser;
  personalAccount: { id: string; name: string };
  identity?: NewIdentity;
}

export interface LinkIdentityOptions {
  /** Marks the email as verified (if it was not) at this instant. */
  verifiedAt: Date;
  /** Drops the password hash: the account can then only be entered through the provider. */
  clearPassword: boolean;
}

export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract findByEmail(email: Email): Promise<User | null>;
  abstract findByIdentity(provider: OAuthProviderName, subject: string): Promise<User | null>;

  /**
   * Creates the user, their personal account (as owner) and, optionally, an OAuth
   * identity in one transaction.
   * @throws EmailAlreadyRegisteredError when the email is taken.
   */
  abstract provision(input: ProvisionUserInput): Promise<User>;

  abstract linkIdentity(
    userId: string,
    identity: NewIdentity,
    options: LinkIdentityOptions,
  ): Promise<void>;

  abstract updatePasswordHash(userId: string, passwordHash: string): Promise<void>;

  /** Memberships ordered by age; the first one is the personal account. */
  abstract listMemberships(userId: string): Promise<Membership[]>;
}
