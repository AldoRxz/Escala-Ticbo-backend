/**
 * Brute-force protection for password sign-in: after MAX_FAILURES failed
 * attempts within WINDOW_MS, the email is locked for LOCK_MS. Applies to any
 * email, registered or not, so a lock never reveals that an account exists.
 */
export const LOGIN_THROTTLE = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
} as const;

export interface ThrottleState {
  failures: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
}

export function isLocked(state: ThrottleState | null, now: Date): boolean {
  return state?.lockedUntil != null && state.lockedUntil > now;
}

/** State after one more failed attempt. */
export function afterFailure(state: ThrottleState | null, now: Date): ThrottleState {
  const windowExpired =
    !state || now.getTime() - state.windowStartedAt.getTime() >= LOGIN_THROTTLE.windowMs;
  const failures = windowExpired ? 1 : state.failures + 1;
  const windowStartedAt = windowExpired ? now : state.windowStartedAt;
  if (failures >= LOGIN_THROTTLE.maxFailures) {
    // Locked: the next window starts when the lock ends.
    const lockedUntil = new Date(now.getTime() + LOGIN_THROTTLE.lockMs);
    return { failures: 0, windowStartedAt: lockedUntil, lockedUntil };
  }
  return { failures, windowStartedAt, lockedUntil: null };
}
