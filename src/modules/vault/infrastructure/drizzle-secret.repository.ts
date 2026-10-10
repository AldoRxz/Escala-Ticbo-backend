import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { encryptedSecrets } from '../../../shared/infrastructure/database/schema/index.js';
import { TenantDatabase } from '../../../shared/infrastructure/database/tenant-database.js';
import type { SecretRepository, StoredSecret } from '../application/ports.js';

// Every query runs inside TenantDatabase.run, so row-level security limits it to
// the given account even if a secret id from another account is passed in.
@Injectable()
export class DrizzleSecretRepository implements SecretRepository {
  constructor(private readonly tenants: TenantDatabase) {}

  async insert(secret: StoredSecret): Promise<void> {
    await this.tenants.run(secret.accountId, (tx) => tx.insert(encryptedSecrets).values(secret));
  }

  async find(accountId: string, secretId: string): Promise<StoredSecret | null> {
    const [row] = await this.tenants.run(accountId, (tx) =>
      tx.select().from(encryptedSecrets).where(eq(encryptedSecrets.id, secretId)).limit(1),
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      accountId: row.accountId,
      kind: row.kind,
      ciphertext: row.ciphertext,
      wrappedDataKey: row.wrappedDataKey,
      keyId: row.keyId,
      algorithm: row.algorithm as StoredSecret['algorithm'],
    };
  }

  async delete(accountId: string, secretId: string): Promise<boolean> {
    const deleted = await this.tenants.run(accountId, (tx) =>
      tx
        .delete(encryptedSecrets)
        .where(eq(encryptedSecrets.id, secretId))
        .returning({ id: encryptedSecrets.id }),
    );
    return deleted.length > 0;
  }
}
