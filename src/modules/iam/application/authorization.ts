import { AppError } from '../../../shared/domain/app-error.js';
import type { MemberRole } from '../domain/user.js';
import type { Principal } from './principal.js';

export class NoActiveAccountError extends AppError {
  override readonly code = 'no_active_account';
  override readonly category = 'forbidden';

  constructor() {
    super('The session has no active account.');
  }
}

export class InsufficientRoleError extends AppError {
  override readonly code = 'insufficient_role';
  override readonly category = 'forbidden';

  constructor() {
    super('Your role in this account does not allow this action.');
  }
}

/** Roles that manage the account's RFCs and WhatsApp numbers. */
export const ACCOUNT_MANAGERS: readonly MemberRole[] = ['owner', 'admin'];

/**
 * The tenant every customer-data route works on. It always comes from the signed
 * access token, never from the URL or the body.
 * @throws NoActiveAccountError
 */
export function activeAccountOf(principal: Principal): string {
  if (!principal.accountId) {
    throw new NoActiveAccountError();
  }
  return principal.accountId;
}

/**
 * The active account, provided the caller's role in it is one of `roles`.
 * @throws NoActiveAccountError, InsufficientRoleError
 */
export function requireRole(principal: Principal, roles: readonly MemberRole[]): string {
  const accountId = activeAccountOf(principal);
  if (!principal.role || !roles.includes(principal.role)) {
    throw new InsufficientRoleError();
  }
  return accountId;
}
