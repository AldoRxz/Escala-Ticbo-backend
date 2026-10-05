import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/shared/domain/id.js';
import {
  type Database,
  DATABASE,
} from '../src/shared/infrastructure/database/database.tokens.js';
import { fiscalProfiles, receipts } from '../src/shared/infrastructure/database/schema/index.js';
import { TenantDatabase } from '../src/shared/infrastructure/database/tenant-database.js';
import { prepareDatabase, resetDatabase, startTestApp } from './support/e2e.js';

/** SQLSTATE of the PostgreSQL error raised by `work` (Drizzle wraps it in `cause`). */
async function sqlState(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    const { code, cause } = error as { code?: string; cause?: { code?: string } };
    return cause?.code ?? code;
  }
}

const RLS_VIOLATION = '42501';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

// The API connects as "ticbo_app"; these tests prove PostgreSQL itself keeps
// tenants apart, even if application code forgets a WHERE clause.
describe('Tenant isolation with row-level security (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: pg.Pool;
  let tenants: TenantDatabase;
  let db: Database;
  const accountA = newId();
  const accountB = newId();

  const profileFor = (accountId: string, rfc: string) => ({
    id: newId(),
    accountId,
    rfc,
    legalName: 'EMPRESA DE PRUEBA',
    taxRegime: '601',
    postalCode: '64000',
    invoiceEmail: `${rfc.toLowerCase()}@inbox.ticbo.test`,
  });

  beforeAll(async () => {
    owner = await prepareDatabase();
    app = await startTestApp();
    tenants = app.get(TenantDatabase);
    db = app.get<Database>(DATABASE);
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
    await tenants.run(accountA, (tx) =>
      tx.insert(fiscalProfiles).values(profileFor(accountA, 'AAA010101AAA')),
    );
  });

  it('shows each tenant only its own rows', async () => {
    const seenByA = await tenants.run(accountA, (tx) => tx.select().from(fiscalProfiles));
    const seenByB = await tenants.run(accountB, (tx) => tx.select().from(fiscalProfiles));

    expect(seenByA.map((profile) => profile.rfc)).toEqual(['AAA010101AAA']);
    expect(seenByB).toEqual([]);
  });

  it('hides every tenant row when no tenant is set (fail closed)', async () => {
    expect(await db.select().from(fiscalProfiles)).toEqual([]);
  });

  it('refuses to write rows for another tenant', async () => {
    const attempt = tenants.run(accountB, (tx) =>
      tx.insert(fiscalProfiles).values(profileFor(accountA, 'BBB010101BBB')),
    );

    expect(await sqlState(attempt)).toBe(RLS_VIOLATION);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const updated = await tenants.run(accountB, (tx) =>
      tx.update(fiscalProfiles).set({ legalName: 'HIJACKED' }).returning(),
    );
    const deleted = await tenants.run(accountB, (tx) =>
      tx.delete(fiscalProfiles).where(eq(fiscalProfiles.rfc, 'AAA010101AAA')).returning(),
    );

    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
    const { rows } = await owner.query('select legal_name from fiscal_profiles');
    expect(rows).toEqual([{ legal_name: 'EMPRESA DE PRUEBA' }]);
  });

  it("cannot reference another tenant's rows through foreign keys", async () => {
    const [profileOfA] = await tenants.run(accountA, (tx) => tx.select().from(fiscalProfiles));

    const attempt = tenants.run(accountB, (tx) =>
      tx.insert(receipts).values({
        id: newId(),
        accountId: accountB,
        fiscalProfileId: profileOfA!.id,
        source: 'web',
        imageObjectKey: 'receipts/b/ticket.jpg',
      }),
    );

    expect(await sqlState(attempt)).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('enforces the RFC format in the database', async () => {
    const attempt = tenants.run(accountA, (tx) =>
      tx.insert(fiscalProfiles).values(profileFor(accountA, 'NOT-AN-RFC')),
    );

    expect(await sqlState(attempt)).toBe(CHECK_VIOLATION);
  });
});
