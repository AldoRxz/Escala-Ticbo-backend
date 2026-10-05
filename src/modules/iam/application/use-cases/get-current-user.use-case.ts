import { Injectable } from '@nestjs/common';
import type { Membership, User } from '../../domain/user.js';
import { InvalidAccessTokenError } from '../errors.js';
import type { Principal } from '../principal.js';
import { UserRepository } from '../ports/user.repository.js';

export interface CurrentUser {
  user: User;
  memberships: Membership[];
}

@Injectable()
export class GetCurrentUserUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(principal: Principal): Promise<CurrentUser> {
    const user = await this.users.findById(principal.userId);
    if (!user) {
      // The token outlived its user (account deleted).
      throw new InvalidAccessTokenError();
    }
    return { user, memberships: await this.users.listMemberships(user.id) };
  }
}
