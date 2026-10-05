import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidRefreshTokenError } from '../errors.js';
import { client, createIamTestbed, testSessionSettings } from '../testing/fakes.js';
import type { AuthSession } from '../session-issuer.js';
import { LogoutUseCase } from './logout.use-case.js';
import { RefreshSessionUseCase } from './refresh-session.use-case.js';
import { RegisterUserUseCase } from './register-user.use-case.js';

describe('RefreshSessionUseCase', () => {
  let testbed: ReturnType<typeof createIamTestbed>;
  let refresh: RefreshSessionUseCase;
  let signedIn: AuthSession;

  beforeEach(async () => {
    testbed = createIamTestbed();
    refresh = new RefreshSessionUseCase(
      testbed.users,
      testbed.sessionRepository,
      testbed.opaqueTokens,
      testbed.sessionIssuer,
      testSessionSettings,
      testbed.clock,
    );
    signedIn = await new RegisterUserUseCase(
      testbed.users,
      testbed.hasher,
      testbed.sessionIssuer,
    ).execute({ email: 'ana@example.com', password: 'correct horse battery', fullName: 'Ana' }, client);
  });

  it('rotates the refresh token within the same family', async () => {
    const rotated = await refresh.execute(signedIn.refreshToken.value, client);

    expect(rotated.refreshToken.value).not.toBe(signedIn.refreshToken.value);
    const active = testbed.sessionRepository.activeSessions();
    expect(active).toHaveLength(1);
    expect(active[0]?.tokenHash).toBe(testbed.opaqueTokens.hash(rotated.refreshToken.value));
  });

  it('extends the expiry on every rotation', async () => {
    testbed.clock.advance(60_000);

    const rotated = await refresh.execute(signedIn.refreshToken.value, client);

    expect(rotated.refreshToken.expiresAt.getTime()).toBe(
      testbed.clock.now().getTime() + testSessionSettings.refreshTokenTtlMs,
    );
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const rotated = await refresh.execute(signedIn.refreshToken.value, client);
    testbed.clock.advance(testSessionSettings.reuseGraceMs + 1);

    await expect(refresh.execute(signedIn.refreshToken.value, client)).rejects.toThrow(
      InvalidRefreshTokenError,
    );
    await expect(refresh.execute(rotated.refreshToken.value, client)).rejects.toThrow(
      InvalidRefreshTokenError,
    );
    expect(testbed.sessionRepository.activeSessions()).toHaveLength(0);
  });

  it('tolerates a replay right after rotation (parallel tabs) without logging out', async () => {
    const rotated = await refresh.execute(signedIn.refreshToken.value, client);
    testbed.clock.advance(1_000);

    await expect(refresh.execute(signedIn.refreshToken.value, client)).rejects.toThrow(
      InvalidRefreshTokenError,
    );
    await expect(refresh.execute(rotated.refreshToken.value, client)).resolves.toBeDefined();
  });

  it('rejects expired, unknown and missing tokens', async () => {
    await expect(refresh.execute(undefined, client)).rejects.toThrow(InvalidRefreshTokenError);
    await expect(refresh.execute('never-issued', client)).rejects.toThrow(
      InvalidRefreshTokenError,
    );

    testbed.clock.advance(testSessionSettings.refreshTokenTtlMs);
    await expect(refresh.execute(signedIn.refreshToken.value, client)).rejects.toThrow(
      InvalidRefreshTokenError,
    );
  });

  it('stops working after logout', async () => {
    await new LogoutUseCase(
      testbed.sessionRepository,
      testbed.opaqueTokens,
      testbed.clock,
    ).execute(signedIn.refreshToken.value);

    await expect(refresh.execute(signedIn.refreshToken.value, client)).rejects.toThrow(
      InvalidRefreshTokenError,
    );
  });
});
