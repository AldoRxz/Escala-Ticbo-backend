import { WeakPasswordError } from './errors.js';

// Length is the rule that matters (NIST SP 800-63B): no composition rules, and an
// upper bound so a huge input cannot be used to burn hashing CPU.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * NFKC normalization, so the same password typed on different keyboards or input
 * methods produces the same bytes. Applied before hashing and before verifying.
 */
export function normalizePassword(plain: string): string {
  return plain.normalize('NFKC');
}

export function assertAcceptablePassword(plain: string): void {
  // NIST counts each Unicode code point as one character, which is what spreading yields.
  // oxlint-disable-next-line typescript/no-misused-spread
  const length = [...normalizePassword(plain)].length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    throw new WeakPasswordError(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH);
  }
}
