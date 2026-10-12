import { Injectable } from '@nestjs/common';
import { ACCOUNT_MANAGERS, requireRole } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import { FiscalProfileNotFoundError } from '../errors.js';
import { FiscalProfileRepository } from '../ports/fiscal-profile.repository.js';

/** Removes an RFC no receipt, invoice or WhatsApp sender uses yet. */
@Injectable()
export class DeleteFiscalProfileUseCase {
  constructor(private readonly profiles: FiscalProfileRepository) {}

  /** @throws FiscalProfileNotFoundError, FiscalProfileInUseError, InsufficientRoleError */
  async execute(principal: Principal, id: string): Promise<void> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    if (!(await this.profiles.delete(accountId, id))) {
      throw new FiscalProfileNotFoundError();
    }
  }
}
