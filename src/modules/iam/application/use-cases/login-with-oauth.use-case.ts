import { Injectable } from '@nestjs/common';
import { Clock } from '../../../../shared/application/clock.js';
import { newId } from '../../../../shared/domain/id.js';
import { Email } from '../../domain/email.js';
import { decideOAuthLink, type OAuthProfile } from '../../domain/oauth.js';
import type { User } from '../../domain/user.js';
import { OAuthEmailNotVerifiedError } from '../errors.js';
import type { ClientContext } from '../principal.js';
import { SessionRepository } from '../ports/session.repository.js';
import { type NewIdentity, UserRepository } from '../ports/user.repository.js';
import { type AuthSession, SessionIssuer } from '../session-issuer.js';

/** Signs in (or up) with an identity already verified by an OAuth provider. */
@Injectable()
export class LoginWithOAuthUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly sessions: SessionIssuer,
    private readonly clock: Clock,
  ) {}

  async execute(profile: OAuthProfile, client: ClientContext): Promise<AuthSession> {
    if (!profile.emailVerified) {
      throw new OAuthEmailNotVerifiedError();
    }

    const linked = await this.users.findByIdentity(profile.provider, profile.subject);
    if (linked) {
      return this.sessions.start(linked, client);
    }

    const email = Email.parse(profile.email);
    const identity: NewIdentity = {
      provider: profile.provider,
      subject: profile.subject,
      email: email.value,
    };
    const existing = await this.users.findByEmail(email);
    const user = existing
      ? await this.linkToExisting(existing, identity)
      : await this.users.provision({
          user: {
            id: newId(),
            email: email.value,
            fullName: profile.fullName,
            passwordHash: null,
            emailVerifiedAt: this.clock.now(),
            avatarUrl: profile.avatarUrl,
          },
          personalAccount: { id: newId(), name: profile.fullName },
          identity,
        });

    return this.sessions.start(user, client);
  }

  private async linkToExisting(existing: User, identity: NewIdentity): Promise<User> {
    const now = this.clock.now();
    const resetCredentials = decideOAuthLink(existing) === 'link_and_reset_credentials';

    await this.users.linkIdentity(existing.id, identity, {
      verifiedAt: now,
      clearPassword: resetCredentials,
    });
    if (resetCredentials) {
      await this.sessionRepository.revokeAllForUser(existing.id, now);
    }

    return {
      ...existing,
      emailVerifiedAt: existing.emailVerifiedAt ?? now,
      passwordHash: resetCredentials ? null : existing.passwordHash,
    };
  }
}
