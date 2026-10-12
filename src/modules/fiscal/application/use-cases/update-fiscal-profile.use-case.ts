import { Injectable } from '@nestjs/common';
import { InvalidInputError } from '../../../../shared/domain/app-error.js';
import { ACCOUNT_MANAGERS, requireRole } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import { type FiscalProfile, validateFiscalData } from '../../domain/fiscal-profile.js';
import { FiscalProfileNotFoundError } from '../errors.js';
import {
  type FiscalProfileChanges,
  FiscalProfileRepository,
} from '../ports/fiscal-profile.repository.js';

/**
 * Edits a profile's name, regime, postal code or default CFDI use. The RFC itself
 * cannot change: a different RFC is a different receiver, so it is a new profile.
 */
@Injectable()
export class UpdateFiscalProfileUseCase {
  constructor(private readonly profiles: FiscalProfileRepository) {}

  /** @throws FiscalProfileNotFoundError, InvalidInputError, InsufficientRoleError */
  async execute(
    principal: Principal,
    id: string,
    changes: Partial<FiscalProfileChanges>,
  ): Promise<FiscalProfile> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const current = await this.profiles.find(accountId, id);
    if (!current) {
      throw new FiscalProfileNotFoundError();
    }

    // Validate the profile as it would end up: a new regime must still fit its CFDI use.
    const result = validateFiscalData({
      rfc: current.rfc,
      legalName: changes.legalName ?? current.legalName,
      taxRegime: changes.taxRegime ?? current.taxRegime,
      postalCode: changes.postalCode ?? current.postalCode,
      defaultCfdiUse: changes.defaultCfdiUse ?? current.defaultCfdiUse,
    });
    if (!result.ok) {
      throw new InvalidInputError(result.issues);
    }

    const { rfc: _rfc, ...next } = result.value;
    const updated = await this.profiles.update(accountId, id, next);
    if (!updated) {
      throw new FiscalProfileNotFoundError();
    }
    return updated;
  }
}
