import { beforeEach, describe, expect, it } from 'vitest';
import { LOGIN_THROTTLE, afterFailure, isLocked } from '../../domain/login-throttle.js';
import { client, createIamTestbed, testSessionSettings } from '../testing/fakes.js';
import { PurgeExpiredAuthDataUseCase } from './purge-expired-auth-data.use-case.js';
import { RegisterUserUseCase } from './register-user.use-case.js';

describe('PurgeExpiredAuthDataUseCase', () => {
  let testbed: ReturnType<typeof createIamTestbed>;
  let purge: PurgeExpiredAuthDataUseCase;

  beforeEach(async () => {
    testbed = createIamTestbed();
    purge = new PurgeExpiredAuthDataUseCase(
      testbed.sessionRepository,
      testbed.throttle,
      testbed.clock,
    );
    await new RegisterUserUseCase(testbed.users, testbed.hasher, testbed.sessionIssuer).execute(
      { email: 'ana@example.com', password: 'correct horse battery', fullName: 'Ana' },
      client,
    );
  });

  it('keeps sessions until they expire', async () => {
    testbed.clock.advance(testSessionSettings.refreshTokenTtlMs - 1);
    expect(await purge.execute()).toEqual({ expiredSessions: 0, staleThrottles: 0 });

    testbed.clock.advance(2);
    expect(await purge.execute()).toEqual({ expiredSessions: 1, staleThrottles: 0 });
    expect(testbed.sessionRepository.sessions.size).toBe(0);
  });

  it('keeps sign-in counters while their window or lock lasts', async () => {
    const fail = (email: string) =>
      testbed.throttle.update(email, (state) => afterFailure(state, testbed.clock.now()));
    await fail('counting@example.com');
    for (let attempt = 0; attempt < LOGIN_THROTTLE.maxFailures; attempt++) {
      await fail('locked@example.com');
    }

    testbed.clock.advance(LOGIN_THROTTLE.windowMs + 1);
    expect((await purge.execute()).staleThrottles).toBe(1);
    const locked = await testbed.throttle.get('locked@example.com');
    expect(locked).not.toBeNull();
    expect(await testbed.throttle.get('counting@example.com')).toBeNull();

    // The lock is over and its window too: nothing left to remember.
    testbed.clock.advance(LOGIN_THROTTLE.lockMs);
    expect(isLocked(locked, testbed.clock.now())).toBe(false);
    expect((await purge.execute()).staleThrottles).toBe(1);
  });
});
