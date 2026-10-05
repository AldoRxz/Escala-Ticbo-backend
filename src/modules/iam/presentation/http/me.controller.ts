import { Controller, Get } from '@nestjs/common';
import type { Principal } from '../../application/principal.js';
import { GetCurrentUserUseCase } from '../../application/use-cases/get-current-user.use-case.js';
import { CurrentPrincipal } from './auth.decorators.js';
import { type MeResponse, toAccountResponse, toUserResponse } from './auth.responses.js';

@Controller('me')
export class MeController {
  constructor(private readonly getCurrentUser: GetCurrentUserUseCase) {}

  @Get()
  async me(@CurrentPrincipal() principal: Principal): Promise<MeResponse> {
    const { user, memberships } = await this.getCurrentUser.execute(principal);
    return {
      user: toUserResponse(user),
      activeAccountId: principal.accountId,
      accounts: memberships.map(toAccountResponse),
    };
  }
}
