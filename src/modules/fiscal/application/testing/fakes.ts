import type { FiscalProfile } from '../../domain/fiscal-profile.js';
import { FiscalProfileRfcTakenError } from '../errors.js';
import type {
  FiscalProfileChanges,
  FiscalProfileRepository,
  NewFiscalProfile,
} from '../ports/fiscal-profile.repository.js';

export class InMemoryFiscalProfileRepository implements FiscalProfileRepository {
  readonly rows: FiscalProfile[] = [];
  private clock = 0;

  list(accountId: string): Promise<FiscalProfile[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.accountId === accountId)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || +a.createdAt - +b.createdAt),
    );
  }

  find(accountId: string, id: string): Promise<FiscalProfile | null> {
    return Promise.resolve(
      this.rows.find((row) => row.accountId === accountId && row.id === id) ?? null,
    );
  }

  insert(profile: NewFiscalProfile): Promise<FiscalProfile> {
    const sameAccount = this.rows.filter((row) => row.accountId === profile.accountId);
    if (sameAccount.some((row) => row.rfc === profile.rfc)) {
      return Promise.reject(new FiscalProfileRfcTakenError());
    }
    const row: FiscalProfile = {
      ...profile,
      isDefault: sameAccount.length === 0,
      verifiedAt: null,
      createdAt: new Date(++this.clock),
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  async update(
    accountId: string,
    id: string,
    changes: FiscalProfileChanges,
  ): Promise<FiscalProfile | null> {
    const row = await this.find(accountId, id);
    if (!row) {
      return null;
    }
    const updated = { ...row, ...changes };
    this.rows.splice(this.rows.indexOf(row), 1, updated);
    return updated;
  }

  async makeDefault(accountId: string, id: string): Promise<FiscalProfile | null> {
    if (!(await this.find(accountId, id))) {
      return null;
    }
    for (const [index, row] of this.rows.entries()) {
      if (row.accountId === accountId) {
        this.rows[index] = { ...row, isDefault: row.id === id };
      }
    }
    return this.find(accountId, id);
  }

  async delete(accountId: string, id: string): Promise<boolean> {
    const row = await this.find(accountId, id);
    if (!row) {
      return false;
    }
    this.rows.splice(this.rows.indexOf(row), 1);
    const [oldest] = (await this.list(accountId)).sort((a, b) => +a.createdAt - +b.createdAt);
    if (row.isDefault && oldest) {
      await this.makeDefault(accountId, oldest.id);
    }
    return true;
  }
}
