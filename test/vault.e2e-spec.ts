import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SecretVault } from '../src/modules/vault/application/secret-vault.js';
import { SecretNotFoundError } from '../src/modules/vault/domain/errors.js';
import { newId } from '../src/shared/domain/id.js';
import { prepareDatabase, resetDatabase, startTestApp } from './support/e2e.js';

describe('Secret vault (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: pg.Pool;
  let vault: SecretVault;
  const accountA = newId();
  const accountB = newId();

  beforeAll(async () => {
    owner = await prepareDatabase();
    app = await startTestApp();
    vault = app.get(SecretVault);
  });

  afterAll(async () => {
    await app.close();
    await owner.end();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await owner.query(
      `insert into accounts (id, name, type) values ($1, 'A', 'organization'), ($2, 'B', 'organization')`,
      [accountA, accountB],
    );
  });

  it('stores only ciphertext and reveals the original value', async () => {
    const token = 'EAAG-whatsapp-access-token-for-account-a';

    const secretId = await vault.store(accountA, 'whatsapp_access_token', token);

    const { rows } = await owner.query<{ ciphertext: Buffer; key_id: string; kind: string }>(
      'select ciphertext, key_id, kind from encrypted_secrets where id = $1',
      [secretId],
    );
    expect(rows[0]?.kind).toBe('whatsapp_access_token');
    expect(rows[0]?.ciphertext.includes(Buffer.from(token))).toBe(false);
    expect((await vault.reveal(accountA, secretId)).toString()).toBe(token);
  });

  it("does not let another account read or delete a secret, even with its id", async () => {
    const secretId = await vault.store(accountA, 'fiel_password', 'contraseña-de-la-efirma');

    await expect(vault.reveal(accountB, secretId)).rejects.toThrow(SecretNotFoundError);
    await expect(vault.remove(accountB, secretId)).rejects.toThrow(SecretNotFoundError);
    expect((await vault.reveal(accountA, secretId)).toString()).toBe('contraseña-de-la-efirma');
  });

  it('removes a secret', async () => {
    const secretId = await vault.store(accountA, 'whatsapp_app_secret', 'app-secret');

    await vault.remove(accountA, secretId);

    await expect(vault.reveal(accountA, secretId)).rejects.toThrow(SecretNotFoundError);
  });
});
