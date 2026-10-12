import { Injectable } from '@nestjs/common';
import { InvalidInputError } from '../../../../shared/domain/app-error.js';
import { newId } from '../../../../shared/domain/id.js';
import { ACCOUNT_MANAGERS, requireRole } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import {
  type FiscalData,
  type FiscalProfile,
  validateFiscalData,
} from '../../domain/fiscal-profile.js';
import { InvoiceEmailAllocator } from '../invoice-email-allocator.js';
import {
  FiscalProfileRepository,
  InvoiceEmailTakenError,
} from '../ports/fiscal-profile.repository.js';

const ALIAS_ATTEMPTS = 3;

/** Registers an RFC the account's receipts can be invoiced to. Owners and admins only. */
@Injectable()
export class CreateFiscalProfileUseCase {
  constructor(
    private readonly profiles: FiscalProfileRepository,
    private readonly invoiceEmails: InvoiceEmailAllocator,
  ) {}

  /** @throws InvalidInputError, FiscalProfileRfcTakenError, InsufficientRoleError */
  async execute(principal: Principal, data: FiscalData): Promise<FiscalProfile> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const result = validateFiscalData(data);
    if (!result.ok) {
      throw new InvalidInputError(result.issues);
    }

    // The alias key is random; a collision is astronomically rare but cheap to retry.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.profiles.insert({
          id: newId(),
          accountId,
          invoiceEmail: this.invoiceEmails.next(),
          ...result.value,
        });
      } catch (error) {
        if (!(error instanceof InvoiceEmailTakenError) || attempt >= ALIAS_ATTEMPTS) {
          throw error;
        }
      }
    }
  }
}
