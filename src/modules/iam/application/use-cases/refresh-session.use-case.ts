import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../../../shared/application/clock.js';
import { InvalidRefreshTokenError } from '../errors.js';
import type { ClientContext } from '../principal.js';
import { OpaqueTokenService } from '../ports/security.js';
import { type RefreshSession, SessionRepository } from '../ports/session.repository.js';
import { UserRepository } from '../ports/user.repository.js';
import { type AuthSession, SessionIssuer, SessionSettings } from '../session-issuer.js';

/**
 * Refresh-token rotation with reuse detection: each refresh token works once.
 * Presenting a token that was already rotated means it leaked (or a client is
 * buggy), so the whole family is revoked and every holder must sign in again.
 */
@Injectable()
export class RefreshSessionUseCase {
  private readonly logger = new Logger(RefreshSessionUseCase.name);

  constructor(
    private readonly users: UserRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly opaqueTokens: OpaqueTokenService,
    private readonly sessions: SessionIssuer,
    private readonly settings: SessionSettings,
    private readonly clock: Clock,
  ) {}

  async execute(refreshToken: string | undefined, client: ClientContext): Promise<AuthSession> {
    if (!refreshToken) {
      throw new InvalidRefreshTokenError();
    }
    const session = await this.sessionRepository.findByTokenHash(
      this.opaqueTokens.hash(refreshToken),
    );
    if (!session) {
      throw new InvalidRefreshTokenError();
    }

    const now = this.clock.now();
    if (session.revokedAt) {
      await this.handleReuse(session, now);
      throw new InvalidRefreshTokenError();
    }
    if (session.expiresAt <= now) {
      throw new InvalidRefreshTokenError();
    }

    const user = await this.users.findById(session.userId);
    if (!user) {
      throw new InvalidRefreshTokenError();
    }
    return this.sessions.rotate(session, user, client);
  }

  private async handleReuse(session: RefreshSession, now: Date): Promise<void> {
    // Two tabs refreshing at once both send the same token; the loser arrives
    // milliseconds after the rotation. That is not theft, so do not log everyone out.
    const justRotated =
      session.replacedById !== null &&
      session.revokedAt !== null &&
      now.getTime() - session.revokedAt.getTime() <= this.settings.reuseGraceMs;
    if (justRotated) {
      return;
    }
    await this.sessionRepository.revokeFamily(session.familyId, now);
    this.logger.warn(
      `Refresh token reuse detected: revoked session family ${session.familyId} of user ${session.userId}`,
    );
  }
}
