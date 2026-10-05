import { beforeEach, describe, expect, it } from 'vitest';
import { EmailAlreadyRegisteredError, WeakPasswordError } from '../../domain/errors.js';
import { client, createIamTestbed } from '../testing/fakes.js';
import { RegisterUserUseCase } from './register-user.use-case.js';

describe('RegisterUserUseCase', () => {
  let testbed: ReturnType<typeof createIamTestbed>;
  let registerUser: RegisterUserUseCase;

  beforeEach(() => {
    testbed = createIamTestbed();
    registerUser = new RegisterUserUseCase(testbed.users, testbed.hasher, testbed.sessionIssuer);
  });

  it('creates the user with a personal account and starts a session', async () => {
    const session = await registerUser.execute(
      { email: ' Ana@Example.com ', password: 'correct horse battery', fullName: ' Ana López ' },
      client,
    );

    expect(session.user).toMatchObject({
      email: 'ana@example.com',
      fullName: 'Ana López',
      emailVerifiedAt: null,
      passwordHash: 'hashed:correct horse battery',
    });
    expect(session.membership).toMatchObject({ accountType: 'personal', role: 'owner' });
    expect(session.refreshToken.value).toBe('refresh-1');
    expect(testbed.sessionRepository.activeSessions()).toHaveLength(1);
    expect(await testbed.accessTokens.verify(session.accessToken.token)).toEqual({
      userId: session.user.id,
      sessionId: testbed.sessionRepository.activeSessions()[0]?.familyId,
      accountId: session.membership?.accountId,
      role: 'owner',
    });
  });

  it('rejects an email that is already registered, whatever its case', async () => {
    await registerUser.execute(
      { email: 'ana@example.com', password: 'correct horse battery', fullName: 'Ana' },
      client,
    );

    await expect(
      registerUser.execute(
        { email: 'ANA@example.com', password: 'another long password', fullName: 'Ana' },
        client,
      ),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('enforces the password policy', async () => {
    await expect(
      registerUser.execute({ email: 'ana@example.com', password: 'short', fullName: 'Ana' }, client),
    ).rejects.toThrow(WeakPasswordError);
    expect(testbed.users.users.size).toBe(0);
  });
});
