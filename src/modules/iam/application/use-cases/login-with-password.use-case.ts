import { Injectable, Logger } from '@nestjs/common';
import { newId } from '../../../../shared/domain/id.js';
import { Email } from '../../domain/email.js';
import { InvalidEmailError } from '../../domain/errors.js';
import { normalizePassword } from '../../domain/password.js';
import type { User } from '../../domain/user.js';
import { InvalidCredentialsError } from '../errors.js';
import type { ClientContext } from '../principal.js';
import { PasswordHasher } from '../ports/security.js';
import { UserRepository } from '../ports/user.repository.js';
import { type AuthSession, SessionIssuer } from '../session-issuer.js';

export interface LoginWithPasswordCommand {
  email: string;
  password: string;
}

@Injectable()
export class LoginWithPasswordUseCase {
  private readonly logger = new Logger(LoginWithPasswordUseCase.name);
  private decoyHash?: Promise<string>;

  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionIssuer,
  ) {}

  /**
   * Every failure (unknown email, OAuth-only user, wrong password) gives the same
   * error after the same amount of hashing work, so responses do not reveal
   * which emails are registered.
   */
  async execute(command: LoginWithPasswordCommand, client: ClientContext): Promise<AuthSession> {
    const password = normalizePassword(command.password);
    const user = await this.findUser(command.email);

    if (!user?.passwordHash) {
      await this.hasher.verify(await this.getDecoyHash(), password);
      throw new InvalidCredentialsError();
    }
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      throw new InvalidCredentialsError();
    }

    if (this.hasher.needsRehash(user.passwordHash)) {
      await this.upgradeHash(user, password);
    }
    return this.sessions.start(user, client);
  }

  private async findUser(rawEmail: string): Promise<User | null> {
    try {
      return await this.users.findByEmail(Email.parse(rawEmail));
    } catch (error) {
      if (error instanceof InvalidEmailError) {
        return null;
      }
      throw error;
    }
  }

  private getDecoyHash(): Promise<string> {
    this.decoyHash ??= this.hasher.hash(newId());
    return this.decoyHash;
  }

  /** Cost parameters changed since this hash was made: store a fresh one. Best effort. */
  private async upgradeHash(user: User, password: string): Promise<void> {
    try {
      await this.users.updatePasswordHash(user.id, await this.hasher.hash(password));
    } catch (error) {
      this.logger.warn(
        `Could not rehash password for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
