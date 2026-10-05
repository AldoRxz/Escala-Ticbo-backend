import { Injectable } from '@nestjs/common';
import { newId } from '../../../../shared/domain/id.js';
import { Email } from '../../domain/email.js';
import { EmailAlreadyRegisteredError } from '../../domain/errors.js';
import { assertAcceptablePassword, normalizePassword } from '../../domain/password.js';
import type { ClientContext } from '../principal.js';
import { PasswordHasher } from '../ports/security.js';
import { UserRepository } from '../ports/user.repository.js';
import { type AuthSession, SessionIssuer } from '../session-issuer.js';

export interface RegisterUserCommand {
  email: string;
  password: string;
  fullName: string;
}

/** Email/password sign-up: creates the user with a personal account and signs them in. */
@Injectable()
export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(command: RegisterUserCommand, client: ClientContext): Promise<AuthSession> {
    const email = Email.parse(command.email);
    assertAcceptablePassword(command.password);

    if (await this.users.findByEmail(email)) {
      throw new EmailAlreadyRegisteredError();
    }

    const fullName = command.fullName.trim();
    const user = await this.users.provision({
      user: {
        id: newId(),
        email: email.value,
        fullName,
        passwordHash: await this.hasher.hash(normalizePassword(command.password)),
        emailVerifiedAt: null,
        avatarUrl: null,
      },
      personalAccount: { id: newId(), name: fullName },
    });

    return this.sessions.start(user, client);
  }
}
