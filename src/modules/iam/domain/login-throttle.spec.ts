import { describe, expect, it } from 'vitest';
import { LOGIN_THROTTLE, afterFailure, isLocked } from './login-throttle.js';

const start = new Date('2026-10-11T12:00:00.000Z');
const later = (ms: number) => new Date(start.getTime() + ms);

describe('login throttle policy', () => {
  it('counts failures inside the window and locks at the limit', () => {
    let state = afterFailure(null, start);
    for (let attempt = 2; attempt < LOGIN_THROTTLE.maxFailures; attempt++) {
      state = afterFailure(state, later(attempt * 1000));
      expect(isLocked(state, later(attempt * 1000))).toBe(false);
    }
    state = afterFailure(state, later(10_000));

    expect(isLocked(state, later(10_000))).toBe(true);
    expect(isLocked(state, later(10_000 + LOGIN_THROTTLE.lockMs))).toBe(false);
  });

  it('starts a new window once the old one expires', () => {
    let state = afterFailure(null, start);
    state = afterFailure(state, later(1000));
    state = afterFailure(state, later(LOGIN_THROTTLE.windowMs + 1000));

    expect(state.failures).toBe(1);
  });
});
