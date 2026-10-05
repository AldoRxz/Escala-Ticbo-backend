export const MEMBER_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export type AccountType = 'personal' | 'organization';

export interface User {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly emailVerifiedAt: Date | null;
  /** Argon2id PHC string; null when the user only signs in through an OAuth provider. */
  readonly passwordHash: string | null;
  readonly avatarUrl: string | null;
  readonly createdAt: Date;
}

/** A user's access to one tenant account. */
export interface Membership {
  readonly accountId: string;
  readonly accountName: string;
  readonly accountType: AccountType;
  readonly role: MemberRole;
}
