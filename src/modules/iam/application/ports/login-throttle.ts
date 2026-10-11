import type { ThrottleState } from '../../domain/login-throttle.js';

/** Stores failed sign-in counters per email; the policy lives in the domain. */
export abstract class LoginThrottleStore {
  abstract get(email: string): Promise<ThrottleState | null>;
  /** Applies `next` to the stored state atomically (concurrent failures are not lost). */
  abstract update(
    email: string,
    next: (state: ThrottleState | null) => ThrottleState,
  ): Promise<void>;
  abstract clear(email: string): Promise<void>;
}
