import type { Clock } from '../../../../shared/application/clock.js';
import type { Email } from '../../domain/email.js';
import { EmailAlreadyRegisteredError } from '../../domain/errors.js';
import type { OAuthProviderName } from '../../domain/oauth.js';
import type { Membership, User } from '../../domain/user.js';
import { InvalidAccessTokenError } from '../errors.js';
import type { Principal } from '../principal.js';
import type {
  AccessTokenService,
  IssuedAccessToken,
  OpaqueTokenService,
  PasswordHasher,
} from '../ports/security.js';
import type {
  NewRefreshSession,
  RefreshSession,
  SessionRepository,
} from '../ports/session.repository.js';
import type {
  LinkIdentityOptions,
  NewIdentity,
  ProvisionUserInput,
  UserRepository,
} from '../ports/user.repository.js';
import { SessionIssuer, type SessionSettings } from '../session-issuer.js';

// In-memory adapters for unit tests of the application layer.

export class FixedClock implements Clock {
  constructor(private current = new Date('2026-10-05T12:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>();
  readonly identities: Array<NewIdentity & { userId: string }> = [];
  readonly memberships = new Map<string, Membership[]>();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    return [...this.users.values()].find((user) => user.email === email.value) ?? null;
  }

  async findByIdentity(provider: OAuthProviderName, subject: string): Promise<User | null> {
    const identity = this.identities.find(
      (candidate) => candidate.provider === provider && candidate.subject === subject,
    );
    return identity ? (this.users.get(identity.userId) ?? null) : null;
  }

  async provision({ user, personalAccount, identity }: ProvisionUserInput): Promise<User> {
    if ([...this.users.values()].some((existing) => existing.email === user.email)) {
      throw new EmailAlreadyRegisteredError();
    }
    const created: User = { ...user, createdAt: new Date() };
    this.users.set(created.id, created);
    this.memberships.set(created.id, [
      {
        accountId: personalAccount.id,
        accountName: personalAccount.name,
        accountType: 'personal',
        role: 'owner',
      },
    ]);
    if (identity) {
      this.identities.push({ ...identity, userId: created.id });
    }
    return created;
  }

  async linkIdentity(
    userId: string,
    identity: NewIdentity,
    options: LinkIdentityOptions,
  ): Promise<void> {
    const user = this.mustGet(userId);
    this.identities.push({ ...identity, userId });
    this.users.set(userId, {
      ...user,
      emailVerifiedAt: user.emailVerifiedAt ?? options.verifiedAt,
      passwordHash: options.clearPassword ? null : user.passwordHash,
    });
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    this.users.set(userId, { ...this.mustGet(userId), passwordHash });
  }

  async listMemberships(userId: string): Promise<Membership[]> {
    return this.memberships.get(userId) ?? [];
  }

  private mustGet(userId: string): User {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`Unknown user ${userId}`);
    }
    return user;
  }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, RefreshSession>();

  async create(session: NewRefreshSession): Promise<void> {
    this.sessions.set(session.id, {
      id: session.id,
      userId: session.userId,
      familyId: session.familyId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      revokedAt: null,
      replacedById: null,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshSession | null> {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.tokenHash === tokenHash,
    );
    return session ? { ...session } : null;
  }

  async rotate(currentId: string, next: NewRefreshSession, now: Date): Promise<boolean> {
    const current = this.sessions.get(currentId);
    if (!current || current.revokedAt) {
      return false;
    }
    this.sessions.set(currentId, { ...current, revokedAt: now, replacedById: next.id });
    await this.create(next);
    return true;
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    this.revokeWhere((session) => session.familyId === familyId, now);
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    this.revokeWhere((session) => session.userId === userId, now);
  }

  activeSessions(): RefreshSession[] {
    return [...this.sessions.values()].filter((session) => !session.revokedAt);
  }

  private revokeWhere(predicate: (session: RefreshSession) => boolean, now: Date): void {
    for (const session of this.sessions.values()) {
      if (predicate(session) && !session.revokedAt) {
        this.sessions.set(session.id, { ...session, revokedAt: now });
      }
    }
  }
}

export class FakePasswordHasher implements PasswordHasher {
  verifyCalls = 0;
  readonly outdatedHashes = new Set<string>();

  async hash(plain: string): Promise<string> {
    return `hashed:${plain}`;
  }

  async verify(passwordHash: string, plain: string): Promise<boolean> {
    this.verifyCalls++;
    return passwordHash === `hashed:${plain}`;
  }

  needsRehash(passwordHash: string): boolean {
    return this.outdatedHashes.has(passwordHash);
  }
}

export class FakeAccessTokenService implements AccessTokenService {
  async issue(principal: Principal): Promise<IssuedAccessToken> {
    return { token: `access:${JSON.stringify(principal)}`, expiresInSeconds: 900 };
  }

  async verify(token: string): Promise<Principal> {
    if (!token.startsWith('access:')) {
      throw new InvalidAccessTokenError();
    }
    return JSON.parse(token.slice('access:'.length)) as Principal;
  }
}

export class FakeOpaqueTokenService implements OpaqueTokenService {
  private issued = 0;

  generate(): { token: string; hash: string } {
    const token = `refresh-${++this.issued}`;
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return `sha256(${token})`;
  }
}

export const testSessionSettings: SessionSettings = {
  refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000,
  reuseGraceMs: 10_000,
};

export function createIamTestbed() {
  const clock = new FixedClock();
  const users = new InMemoryUserRepository();
  const sessionRepository = new InMemorySessionRepository();
  const hasher = new FakePasswordHasher();
  const accessTokens = new FakeAccessTokenService();
  const opaqueTokens = new FakeOpaqueTokenService();
  const sessionIssuer = new SessionIssuer(
    users,
    sessionRepository,
    opaqueTokens,
    accessTokens,
    testSessionSettings,
    clock,
  );
  return { clock, users, sessionRepository, hasher, accessTokens, opaqueTokens, sessionIssuer };
}

export const client = { userAgent: 'vitest', ipAddress: '127.0.0.1' } as const;
