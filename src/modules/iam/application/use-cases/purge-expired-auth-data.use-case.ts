import { Injectable } from '@nestjs/common';
import { Clock } from '../../../../shared/application/clock.js';
import { staleThrottleCutoff } from '../../domain/login-throttle.js';
import { LoginThrottleStore } from '../ports/login-throttle.js';
import { SessionRepository } from '../ports/session.repository.js';

export interface PurgeResult {
  expiredSessions: number;
  staleThrottles: number;
}

/**
 * Deletes auth rows that can no longer change any decision: refresh tokens past
 * their expiry (refresh rejects them anyway) and spent sign-in counters. Runs on
 * a schedule (the `maintenance` task).
 */
@Injectable()
export class PurgeExpiredAuthDataUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly throttles: LoginThrottleStore,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<PurgeResult> {
    const now = this.clock.now();
    return {
      expiredSessions: await this.sessions.deleteExpired(now),
      staleThrottles: await this.throttles.deleteStale(staleThrottleCutoff(now)),
    };
  }
}
