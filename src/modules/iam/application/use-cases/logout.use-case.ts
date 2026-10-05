import { Injectable } from '@nestjs/common';
import { Clock } from '../../../../shared/application/clock.js';
import { OpaqueTokenService } from '../ports/security.js';
import { SessionRepository } from '../ports/session.repository.js';

/** Ends the session family of the given refresh token. Idempotent. */
@Injectable()
export class LogoutUseCase {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly opaqueTokens: OpaqueTokenService,
    private readonly clock: Clock,
  ) {}

  async execute(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    const session = await this.sessionRepository.findByTokenHash(
      this.opaqueTokens.hash(refreshToken),
    );
    if (session) {
      await this.sessionRepository.revokeFamily(session.familyId, this.clock.now());
    }
  }
}
