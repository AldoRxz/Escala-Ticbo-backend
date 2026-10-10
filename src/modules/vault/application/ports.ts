import type { SecretKind } from '../domain/secret.js';

export interface SealedSecret {
  /** iv (12 bytes) || auth tag (16 bytes) || ciphertext */
  ciphertext: Buffer;
  wrappedDataKey: Buffer;
  /** Key-encryption key that wrapped the data key. */
  keyId: string;
  algorithm: 'AES-256-GCM';
}

/** Envelope encryption: a fresh data key per secret, wrapped by a key-encryption key. */
export abstract class EnvelopeCipher {
  abstract seal(plaintext: Buffer, context: Buffer): Promise<SealedSecret>;
  /** @throws SecretIntegrityError */
  abstract open(sealed: SealedSecret, context: Buffer): Promise<Buffer>;
}

export interface StoredSecret extends SealedSecret {
  id: string;
  accountId: string;
  kind: SecretKind;
}

/** Persistence of sealed secrets, always scoped to one account. */
export abstract class SecretRepository {
  abstract insert(secret: StoredSecret): Promise<void>;
  abstract find(accountId: string, secretId: string): Promise<StoredSecret | null>;
  abstract delete(accountId: string, secretId: string): Promise<boolean>;
}
