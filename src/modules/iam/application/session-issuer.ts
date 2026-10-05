import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/application/clock.js';
import { newId } from '../../../shared/domain/id.js';
import type { Membership, User } from '../domain/user.js';
import { InvalidRefreshTokenError } from './errors.js';
import type { ClientContext } from './principal.js';
import { AccessTokenService, type IssuedAccessToken, OpaqueTokenService } from './ports/security.js';
import {
  type NewRefreshSession,
  type RefreshSession,
  SessionRepository,
} from './ports/session.repository.js';
import { UserRepository } from './ports/user.repository.js';

export abstract class SessionSettings {
  abstract readonly refreshTokenTtlMs: number;
  /** A token rotated less than this long ago is rejected without revoking its family. */
  abstract readonly reuseGraceMs: number;
}

export interface AuthSession {
  user: User;
  membership: Membership | null;
  accessToken: IssuedAccessToken;
  refreshToken: { value: string; expiresAt: Date };
}

/** Issues the access/refresh token pair at sign-in and on every rotation. */
@Injectable()
export class SessionIssuer {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly opaqueTokens: OpaqueTokenService,
    private readonly accessTokens: AccessTokenService,
    private readonly settings: SessionSettings,
    private readonly clock: Clock,
  ) {}

  /** Starts a new refresh-token family (a new sign-in). */
  async start(user: User, client: ClientContext): Promise<AuthSession> {
    const refresh = this.prepareRefreshToken(user.id, newId(), client);
    await this.sessions.create(refresh.record);
    return this.complete(user, refresh);
  }

  /**
   * Replaces `current` with a new token of the same family.
   * @throws InvalidRefreshTokenError if a concurrent request already rotated it.
   */
  async rotate(current: RefreshSession, user: User, client: ClientContext): Promise<AuthSession> {
    const refresh = this.prepareRefreshToken(user.id, current.familyId, client);
    const rotated = await this.sessions.rotate(current.id, refresh.record, this.clock.now());
    if (!rotated) {
      throw new InvalidRefreshTokenError();
    }
    return this.complete(user, refresh);
  }

  private prepareRefreshToken(
    userId: string,
    familyId: string,
    client: ClientContext,
  ): { token: string; record: NewRefreshSession } {
    const { token, hash } = this.opaqueTokens.generate();
    const expiresAt = new Date(this.clock.now().getTime() + this.settings.refreshTokenTtlMs);
    return {
      token,
      record: {
        id: newId(),
        userId,
        familyId,
        tokenHash: hash,
        expiresAt,
        userAgent: client.userAgent,
        ipAddress: client.ipAddress,
      },
    };
  }

  private async complete(
    user: User,
    refresh: { token: string; record: NewRefreshSession },
  ): Promise<AuthSession> {
    const [membership = null] = await this.users.listMemberships(user.id);
    const accessToken = await this.accessTokens.issue({
      userId: user.id,
      sessionId: refresh.record.familyId,
      accountId: membership?.accountId ?? null,
      role: membership?.role ?? null,
    });
    return {
      user,
      membership,
      accessToken,
      refreshToken: { value: refresh.token, expiresAt: refresh.record.expiresAt },
    };
  }
}
