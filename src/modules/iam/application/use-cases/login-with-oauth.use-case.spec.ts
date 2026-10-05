import { beforeEach, describe, expect, it } from 'vitest';
import type { OAuthProfile } from '../../domain/oauth.js';
import { OAuthEmailNotVerifiedError } from '../errors.js';
import { client, createIamTestbed } from '../testing/fakes.js';
import { LoginWithOAuthUseCase } from './login-with-oauth.use-case.js';
import { RegisterUserUseCase } from './register-user.use-case.js';

const profile: OAuthProfile = {
  provider: 'google',
  subject: 'google-sub-123',
  email: 'Ana@Example.com',
  emailVerified: true,
  fullName: 'Ana López',
  avatarUrl: 'https://example.com/ana.png',
};

describe('LoginWithOAuthUseCase', () => {
  let testbed: ReturnType<typeof createIamTestbed>;
  let loginWithOAuth: LoginWithOAuthUseCase;
  let registerUser: RegisterUserUseCase;

  beforeEach(() => {
    testbed = createIamTestbed();
    loginWithOAuth = new LoginWithOAuthUseCase(
      testbed.users,
      testbed.sessionRepository,
      testbed.sessionIssuer,
      testbed.clock,
    );
    registerUser = new RegisterUserUseCase(testbed.users, testbed.hasher, testbed.sessionIssuer);
  });

  it('creates a verified, password-less user on first sign-in', async () => {
    const session = await loginWithOAuth.execute(profile, client);

    expect(session.user).toMatchObject({
      email: 'ana@example.com',
      passwordHash: null,
      emailVerifiedAt: testbed.clock.now(),
      avatarUrl: profile.avatarUrl,
    });
    expect(session.membership?.accountType).toBe('personal');
    expect(testbed.users.identities).toEqual([
      expect.objectContaining({ provider: 'google', subject: 'google-sub-123' }),
    ]);
  });

  it('signs in the same user by provider subject even if the email changed', async () => {
    const first = await loginWithOAuth.execute(profile, client);
    const second = await loginWithOAuth.execute(
      { ...profile, email: 'ana.nuevo@example.com' },
      client,
    );

    expect(second.user.id).toBe(first.user.id);
    expect(testbed.users.users.size).toBe(1);
  });

  it('links to an existing verified account and keeps its password', async () => {
    const registered = await registerUser.execute(
      { email: 'ana@example.com', password: 'correct horse battery', fullName: 'Ana' },
      client,
    );
    await testbed.users.linkIdentity(
      registered.user.id,
      { provider: 'facebook', subject: 'fb-1', email: 'ana@example.com' },
      { verifiedAt: testbed.clock.now(), clearPassword: false },
    );

    const session = await loginWithOAuth.execute(profile, client);

    expect(session.user.id).toBe(registered.user.id);
    expect(session.user.passwordHash).toBe('hashed:correct horse battery');
    expect(testbed.sessionRepository.activeSessions()).toHaveLength(2);
  });

  it('discards the password and sessions of an unverified account with the same email', async () => {
    const squatter = await registerUser.execute(
      { email: 'ana@example.com', password: 'attacker password', fullName: 'Not Ana' },
      client,
    );

    const session = await loginWithOAuth.execute(profile, client);

    expect(session.user.id).toBe(squatter.user.id);
    expect(testbed.users.users.get(squatter.user.id)).toMatchObject({
      passwordHash: null,
      emailVerifiedAt: testbed.clock.now(),
    });
    // Only the session just started through Google survives.
    expect(testbed.sessionRepository.activeSessions()).toHaveLength(1);
    expect(testbed.sessionRepository.activeSessions()[0]?.tokenHash).toBe(
      testbed.opaqueTokens.hash(session.refreshToken.value),
    );
  });

  it('refuses identities whose email the provider did not verify', async () => {
    await expect(
      loginWithOAuth.execute({ ...profile, emailVerified: false }, client),
    ).rejects.toThrow(OAuthEmailNotVerifiedError);
    expect(testbed.users.users.size).toBe(0);
  });
});
