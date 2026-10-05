import type { AuthSession } from '../../application/session-issuer.js';
import type { AccountType, MemberRole, Membership, User } from '../../domain/user.js';

export interface UserResponse {
  id: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AccountResponse {
  id: string;
  name: string;
  type: AccountType;
  role: MemberRole;
}

export interface AuthSessionResponse {
  tokenType: 'Bearer';
  accessToken: string;
  /** Seconds until the access token expires; refresh before then. */
  expiresIn: number;
  user: UserResponse;
  account: AccountResponse | null;
}

export interface MeResponse {
  user: UserResponse;
  activeAccountId: string | null;
  accounts: AccountResponse[];
}

export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    emailVerified: user.emailVerifiedAt !== null,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toAccountResponse(membership: Membership): AccountResponse {
  return {
    id: membership.accountId,
    name: membership.accountName,
    type: membership.accountType,
    role: membership.role,
  };
}

export function toAuthSessionResponse(session: AuthSession): AuthSessionResponse {
  return {
    tokenType: 'Bearer',
    accessToken: session.accessToken.token,
    expiresIn: session.accessToken.expiresInSeconds,
    user: toUserResponse(session.user),
    account: session.membership ? toAccountResponse(session.membership) : null,
  };
}
