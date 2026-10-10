import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretIntegrityError } from '../domain/errors.js';
import { secretContext } from '../domain/secret.js';
import { AesGcmEnvelopeCipher } from './aes-gcm-envelope.cipher.js';
import { LocalKeyWrapper } from './key-wrapper.js';

const key = (id: string) => ({ id, key: randomBytes(32) });
const context = secretContext({
  accountId: '0190f5e0-0000-7000-8000-000000000001',
  kind: 'whatsapp_access_token',
  secretId: '0190f5e0-0000-7000-8000-0000000000aa',
});

describe('AesGcmEnvelopeCipher with LocalKeyWrapper', () => {
  const v1 = key('local-v1');
  const cipher = new AesGcmEnvelopeCipher(new LocalKeyWrapper([v1]));

  it('round-trips the plaintext and never stores it in the clear', async () => {
    const plaintext = Buffer.from('EAAG-whatsapp-token-123');

    const sealed = await cipher.seal(plaintext, context);

    expect(sealed.keyId).toBe('local-v1');
    expect(sealed.ciphertext.includes(plaintext)).toBe(false);
    expect(sealed.ciphertext.length).toBe(12 + 16 + plaintext.length);
    expect(await cipher.open(sealed, context)).toEqual(plaintext);
  });

  it('uses a fresh data key and IV every time', async () => {
    const plaintext = Buffer.from('same secret');

    const first = await cipher.seal(plaintext, context);
    const second = await cipher.seal(plaintext, context);

    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
    expect(first.wrappedDataKey.equals(second.wrappedDataKey)).toBe(false);
  });

  it('detects a modified ciphertext', async () => {
    const sealed = await cipher.seal(Buffer.from('secret'), context);
    sealed.ciphertext[sealed.ciphertext.length - 1]! ^= 0x01;

    await expect(cipher.open(sealed, context)).rejects.toThrow(SecretIntegrityError);
  });

  it('refuses to open a ciphertext moved to another account or kind', async () => {
    const sealed = await cipher.seal(Buffer.from('secret'), context);
    const otherAccount = secretContext({
      accountId: '0190f5e0-0000-7000-8000-000000000002',
      kind: 'whatsapp_access_token',
      secretId: '0190f5e0-0000-7000-8000-0000000000aa',
    });
    const otherKind = secretContext({
      accountId: '0190f5e0-0000-7000-8000-000000000001',
      kind: 'fiel_password',
      secretId: '0190f5e0-0000-7000-8000-0000000000aa',
    });

    await expect(cipher.open(sealed, otherAccount)).rejects.toThrow(SecretIntegrityError);
    await expect(cipher.open(sealed, otherKind)).rejects.toThrow(SecretIntegrityError);
  });

  it('keeps old secrets readable after a key rotation', async () => {
    const old = await cipher.seal(Buffer.from('sealed with v1'), context);
    const rotated = new AesGcmEnvelopeCipher(new LocalKeyWrapper([key('local-v2'), v1]));

    const fresh = await rotated.seal(Buffer.from('sealed with v2'), context);

    expect(fresh.keyId).toBe('local-v2');
    expect((await rotated.open(old, context)).toString()).toBe('sealed with v1');
  });

  it('fails clearly when the key-encryption key is missing or wrong', async () => {
    const sealed = await cipher.seal(Buffer.from('secret'), context);
    const withoutV1 = new AesGcmEnvelopeCipher(new LocalKeyWrapper([key('local-v2')]));
    const wrongV1 = new AesGcmEnvelopeCipher(new LocalKeyWrapper([key('local-v1')]));

    await expect(withoutV1.open(sealed, context)).rejects.toThrow(/not configured/);
    await expect(wrongV1.open(sealed, context)).rejects.toThrow(SecretIntegrityError);
  });
});
