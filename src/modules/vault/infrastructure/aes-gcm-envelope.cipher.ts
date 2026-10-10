import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EnvelopeCipher, SealedSecret } from '../application/ports.js';
import { SecretIntegrityError } from '../domain/errors.js';
import type { KeyWrapper } from './key-wrapper.js';

const DATA_KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** AES-256-GCM with a random data key per secret; data keys are wrapped by a KeyWrapper. */
export class AesGcmEnvelopeCipher implements EnvelopeCipher {
  constructor(private readonly keys: KeyWrapper) {}

  async seal(plaintext: Buffer, context: Buffer): Promise<SealedSecret> {
    const dataKey = randomBytes(DATA_KEY_LENGTH);
    try {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
      cipher.setAAD(context);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const { wrappedKey, keyId } = await this.keys.wrap(dataKey, context);
      return {
        ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
        wrappedDataKey: wrappedKey,
        keyId,
        algorithm: 'AES-256-GCM',
      };
    } finally {
      dataKey.fill(0);
    }
  }

  async open(sealed: SealedSecret, context: Buffer): Promise<Buffer> {
    if (sealed.algorithm !== 'AES-256-GCM') {
      throw new SecretIntegrityError(`unsupported algorithm ${String(sealed.algorithm)}`);
    }
    const dataKey = await this.keys.unwrap(sealed.wrappedDataKey, sealed.keyId, context);
    try {
      const { ciphertext } = sealed;
      const decipher = createDecipheriv('aes-256-gcm', dataKey, ciphertext.subarray(0, IV_LENGTH));
      decipher.setAAD(context);
      decipher.setAuthTag(ciphertext.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
      return Buffer.concat([
        decipher.update(ciphertext.subarray(IV_LENGTH + TAG_LENGTH)),
        decipher.final(),
      ]);
    } catch (error) {
      throw new SecretIntegrityError('ciphertext does not authenticate', { cause: error });
    } finally {
      dataKey.fill(0);
    }
  }
}
