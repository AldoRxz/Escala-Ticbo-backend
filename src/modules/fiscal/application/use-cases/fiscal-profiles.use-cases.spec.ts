import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidInputError } from '../../../../shared/domain/app-error.js';
import {
  InsufficientRoleError,
  NoActiveAccountError,
} from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import type { FiscalData } from '../../domain/fiscal-profile.js';
import { FiscalProfileNotFoundError, FiscalProfileRfcTakenError } from '../errors.js';
import { InvoiceEmailAllocator } from '../invoice-email-allocator.js';
import { InvoiceEmailTakenError } from '../ports/fiscal-profile.repository.js';
import { InMemoryFiscalProfileRepository } from '../testing/fakes.js';
import { CreateFiscalProfileUseCase } from './create-fiscal-profile.use-case.js';
import { DeleteFiscalProfileUseCase } from './delete-fiscal-profile.use-case.js';
import { ListFiscalProfilesUseCase } from './list-fiscal-profiles.use-case.js';
import { MakeDefaultFiscalProfileUseCase } from './make-default-fiscal-profile.use-case.js';
import { UpdateFiscalProfileUseCase } from './update-fiscal-profile.use-case.js';

const owner: Principal = { userId: 'u1', sessionId: 's1', accountId: 'acc-1', role: 'owner' };
const member: Principal = { ...owner, userId: 'u2', role: 'member' };
const otherAccount: Principal = { ...owner, userId: 'u3', accountId: 'acc-2' };

const andina: FiscalData = {
  rfc: 'GAS1902148K3',
  legalName: 'Grupo Andina',
  taxRegime: '601',
  postalCode: '06600',
  defaultCfdiUse: 'G03',
};
const logistica: FiscalData = { ...andina, rfc: 'ALO2005117T2', legalName: 'Andina Logística' };

describe('Fiscal profile use cases', () => {
  let repository: InMemoryFiscalProfileRepository;
  let create: CreateFiscalProfileUseCase;

  beforeEach(() => {
    repository = new InMemoryFiscalProfileRepository();
    create = new CreateFiscalProfileUseCase(
      repository,
      new InvoiceEmailAllocator({ address: 'ticbomx@gmail.com' }),
    );
  });

  it('creates the first profile as the default, with an inbox alias', async () => {
    const profile = await create.execute(owner, andina);

    expect(profile).toMatchObject({
      accountId: 'acc-1',
      rfc: 'GAS1902148K3',
      legalName: 'GRUPO ANDINA',
      isDefault: true,
    });
    expect(profile.invoiceEmail).toMatch(/^ticbomx\+[a-z2-9]{8}@gmail\.com$/);
    expect((await create.execute(owner, logistica)).isDefault).toBe(false);
  });

  it('gives every profile its own inbox alias', async () => {
    const a = await create.execute(owner, andina);
    const b = await create.execute(owner, logistica);

    expect(a.invoiceEmail).not.toBe(b.invoiceEmail);
  });

  it('retries when the generated alias is taken', async () => {
    let failures = 1;
    const insert = repository.insert.bind(repository);
    repository.insert = (profile) =>
      failures-- > 0 ? Promise.reject(new InvoiceEmailTakenError()) : insert(profile);

    await expect(create.execute(owner, andina)).resolves.toMatchObject({ rfc: 'GAS1902148K3' });
  });

  it('rejects invalid data and a repeated RFC', async () => {
    await expect(create.execute(owner, { ...andina, taxRegime: '612' })).rejects.toThrow(
      InvalidInputError,
    );
    await create.execute(owner, andina);
    await expect(create.execute(owner, andina)).rejects.toThrow(FiscalProfileRfcTakenError);
  });

  it('lets members read but not change the profiles', async () => {
    const profile = await create.execute(owner, andina);
    const list = new ListFiscalProfilesUseCase(repository);

    await expect(list.execute(member)).resolves.toHaveLength(1);
    await expect(create.execute(member, logistica)).rejects.toThrow(InsufficientRoleError);
    await expect(
      new DeleteFiscalProfileUseCase(repository).execute(member, profile.id),
    ).rejects.toThrow(InsufficientRoleError);
    await expect(list.execute({ ...owner, accountId: null })).rejects.toThrow(NoActiveAccountError);
  });

  it('validates an update against the stored RFC', async () => {
    const profile = await create.execute(owner, andina);
    const update = new UpdateFiscalProfileUseCase(repository);

    await expect(update.execute(owner, profile.id, { taxRegime: '612' })).rejects.toThrow(
      InvalidInputError,
    );
    await expect(
      update.execute(owner, profile.id, { postalCode: '64000', legalName: 'andina sa' }),
    ).resolves.toMatchObject({ rfc: 'GAS1902148K3', postalCode: '64000', legalName: 'ANDINA SA' });
  });

  it('lets the suggested CFDI use be left out or cleared', async () => {
    const profile = await create.execute(owner, { ...andina, defaultCfdiUse: null });
    expect(profile.defaultCfdiUse).toBeNull();

    const update = new UpdateFiscalProfileUseCase(repository);
    await expect(
      update.execute(owner, profile.id, { defaultCfdiUse: 'G01' }),
    ).resolves.toMatchObject({ defaultCfdiUse: 'G01' });
    // Omitted keeps it; null clears it.
    await expect(update.execute(owner, profile.id, { postalCode: '64000' })).resolves.toMatchObject(
      { defaultCfdiUse: 'G01' },
    );
    await expect(
      update.execute(owner, profile.id, { defaultCfdiUse: null }),
    ).resolves.toMatchObject({ defaultCfdiUse: null });
  });

  it('does not reach the profiles of another account', async () => {
    const profile = await create.execute(owner, andina);

    await expect(
      new UpdateFiscalProfileUseCase(repository).execute(otherAccount, profile.id, {
        postalCode: '64000',
      }),
    ).rejects.toThrow(FiscalProfileNotFoundError);
    await expect(
      new MakeDefaultFiscalProfileUseCase(repository).execute(otherAccount, profile.id),
    ).rejects.toThrow(FiscalProfileNotFoundError);
  });

  it('moves the default when it is changed or deleted', async () => {
    const first = await create.execute(owner, andina);
    const second = await create.execute(owner, logistica);

    await new MakeDefaultFiscalProfileUseCase(repository).execute(owner, second.id);
    expect((await repository.find('acc-1', first.id))?.isDefault).toBe(false);

    await new DeleteFiscalProfileUseCase(repository).execute(owner, second.id);
    expect((await repository.find('acc-1', first.id))?.isDefault).toBe(true);
  });
});
