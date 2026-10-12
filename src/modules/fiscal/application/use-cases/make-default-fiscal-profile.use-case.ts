import { Injectable } from '@nestjs/common';
import { ACCOUNT_MANAGERS, requireRole } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import type { FiscalProfile } from '../../domain/fiscal-profile.js';
import { FiscalProfileNotFoundError } from '../errors.js';
import { FiscalProfileRepository } from '../ports/fiscal-profile.repository.js';

/** Picks the RFC used when a sender has none of their own. */
@Injectable()
export class MakeDefaultFiscalProfileUseCase {
  constructor(private readonly profiles: FiscalProfileRepository) {}

  /** @throws FiscalProfileNotFoundError, InsufficientRoleError */
  async execute(principal: Principal, id: string): Promise<FiscalProfile> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const profile = await this.profiles.makeDefault(accountId, id);
    if (!profile) {
      throw new FiscalProfileNotFoundError();
    }
    return profile;
  }
}
