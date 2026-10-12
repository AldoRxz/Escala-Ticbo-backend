import { Injectable } from '@nestjs/common';
import { activeAccountOf } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import type { FiscalProfile } from '../../domain/fiscal-profile.js';
import { FiscalProfileRepository } from '../ports/fiscal-profile.repository.js';

/** Every member of the account can see its RFCs. */
@Injectable()
export class ListFiscalProfilesUseCase {
  constructor(private readonly profiles: FiscalProfileRepository) {}

  async execute(principal: Principal): Promise<FiscalProfile[]> {
    return this.profiles.list(activeAccountOf(principal));
  }
}
