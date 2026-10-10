import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SecretIntegrityError } from '../domain/errors.js';

/**
 * Wraps and unwraps data keys with a key-encryption key (KEK). The local
 * implementation keeps KEKs in configuration; an AWS KMS implementation keeps
 * them inside KMS and passes `context` as the KMS encryption context.
 */
export interface KeyWrapper {
  wrap(dataKey: Buffer, context: Buffer): Promise<{ wrappedKey: Buffer; keyId: string }>;
  unwrap(wrappedKey: Buffer, keyId: string, context: Buffer): Promise<Buffer>;
}

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * KEKs from the VAULT_KEYS setting, held in the platform's secret manager, never
 * in the database. The first key wraps new data keys; older ones stay listed
 * until every secret has been re-wrapped, so rotation needs no downtime.
 */
export class LocalKeyWrapper implements KeyWrapper {
  private readonly keys: ReadonlyMap<string, Buffer>;
  private readonly activeKeyId: string;

  constructor(keys: Array<{ id: string; key: Buffer }>) {
    const [active] = keys;
    if (!active) {
      throw new Error('LocalKeyWrapper needs at least one key');
    }
    this.keys = new Map(keys.map(({ id, key }) => [id, key]));
    this.activeKeyId = active.id;
  }

  async wrap(dataKey: Buffer, context: Buffer): Promise<{ wrappedKey: Buffer; keyId: string }> {
    const keyId = this.activeKeyId;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(keyId)!, iv);
    cipher.setAAD(wrapContext(keyId, context));
    const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return { wrappedKey: Buffer.concat([iv, cipher.getAuthTag(), wrapped]), keyId };
  }

  async unwrap(wrappedKey: Buffer, keyId: string, context: Buffer): Promise<Buffer> {
    const key = this.keys.get(keyId);
    if (!key) {
      throw new SecretIntegrityError(`key-encryption key "${keyId}" is not configured`);
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, wrappedKey.subarray(0, IV_LENGTH));
      decipher.setAAD(wrapContext(keyId, context));
      decipher.setAuthTag(wrappedKey.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
      return Buffer.concat([
        decipher.update(wrappedKey.subarray(IV_LENGTH + TAG_LENGTH)),
        decipher.final(),
      ]);
    } catch (error) {
      throw new SecretIntegrityError('data key does not unwrap', { cause: error });
    }
  }
}

function wrapContext(keyId: string, context: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${keyId}|`, 'utf8'), context]);
}
