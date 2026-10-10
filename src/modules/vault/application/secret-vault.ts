import { Injectable } from '@nestjs/common';
import { newId } from '../../../shared/domain/id.js';
import { SecretNotFoundError } from '../domain/errors.js';
import { type SecretKind, secretContext } from '../domain/secret.js';
import { EnvelopeCipher, SecretRepository } from './ports.js';

/**
 * Stores customers' secrets (WhatsApp tokens, e.firma/CSD keys) encrypted, and
 * gives them back only to code that is about to use them. Plaintext is never
 * persisted, logged or returned by the HTTP API.
 */
@Injectable()
export class SecretVault {
  constructor(
    private readonly cipher: EnvelopeCipher,
    private readonly secrets: SecretRepository,
  ) {}

  /** Encrypts and stores `plaintext`; returns the id to reference it from other rows. */
  async store(accountId: string, kind: SecretKind, plaintext: string | Buffer): Promise<string> {
    const secretId = newId();
    const sealed = await this.cipher.seal(
      typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext,
      secretContext({ accountId, kind, secretId }),
    );
    await this.secrets.insert({ id: secretId, accountId, kind, ...sealed });
    return secretId;
  }

  /**
   * Decrypts a secret of `accountId`. Call it right before use and do not keep
   * the result around; overwrite the buffer (`fill(0)`) once done.
   * @throws SecretNotFoundError, SecretIntegrityError
   */
  async reveal(accountId: string, secretId: string): Promise<Buffer> {
    const secret = await this.secrets.find(accountId, secretId);
    if (!secret) {
      throw new SecretNotFoundError();
    }
    return this.cipher.open(secret, secretContext({ accountId, kind: secret.kind, secretId }));
  }

  /** @throws SecretNotFoundError */
  async remove(accountId: string, secretId: string): Promise<void> {
    if (!(await this.secrets.delete(accountId, secretId))) {
      throw new SecretNotFoundError();
    }
  }
}
