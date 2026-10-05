import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidCredentialsError } from '../errors.js';
import { client, createIamTestbed } from '../testing/fakes.js';
import { LoginWithPasswordUseCase } from './login-with-password.use-case.js';
import { RegisterUserUseCase } from './register-user.use-case.js';

describe('LoginWithPasswordUseCase', () => {
  let testbed: ReturnType<typeof createIamTestbed>;
  let login: LoginWithPasswordUseCase;

  beforeEach(async () => {
    testbed = createIamTestbed();
    login = new LoginWithPasswordUseCase(testbed.users, testbed.hasher, testbed.sessionIssuer);
    await new RegisterUserUseCase(testbed.users, testbed.hasher, testbed.sessionIssuer).execute(
      { email: 'ana@example.com', password: 'correct horse battery', fullName: 'Ana' },
      client,
    );
  });

  it('starts a session for valid credentials', async () => {
    const session = await login.execute(
      { email: 'ANA@example.com', password: 'correct horse battery' },
      client,
    );

    expect(session.user.email).toBe('ana@example.com');
    expect(testbed.sessionRepository.activeSessions()).toHaveLength(2);
  });

  it('rejects a wrong password', async () => {
    await expect(
      login.execute({ email: 'ana@example.com', password: 'wrong password!!' }, client),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it.each([
    ['an unknown email', 'nobody@example.com'],
    ['a malformed email', 'not-an-email'],
  ])('fails like a wrong password for %s, after the same hashing work', async (_, email) => {
    testbed.hasher.verifyCalls = 0;

    await expect(login.execute({ email, password: 'whatever it is' }, client)).rejects.toThrow(
      InvalidCredentialsError,
    );
    expect(testbed.hasher.verifyCalls).toBe(1);
  });

  it('rejects users who only have an OAuth identity', async () => {
    const [user] = testbed.users.users.values();
    testbed.users.users.set(user!.id, { ...user!, passwordHash: null });

    await expect(
      login.execute({ email: 'ana@example.com', password: 'correct horse battery' }, client),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('upgrades a hash made with outdated parameters', async () => {
    testbed.hasher.outdatedHashes.add('hashed:correct horse battery');
    const updates: string[] = [];
    const original = testbed.users.updatePasswordHash.bind(testbed.users);
    testbed.users.updatePasswordHash = async (userId, hash) => {
      updates.push(hash);
      await original(userId, hash);
    };

    await login.execute({ email: 'ana@example.com', password: 'correct horse battery' }, client);

    expect(updates).toEqual(['hashed:correct horse battery']);
  });
});
