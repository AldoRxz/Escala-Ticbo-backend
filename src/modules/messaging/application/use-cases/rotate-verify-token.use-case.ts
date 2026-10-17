import { Injectable } from '@nestjs/common';
import { ACCOUNT_MANAGERS, requireRole } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import { WhatsAppChannelNotFoundError } from '../errors.js';
import { WhatsAppChannelRepository } from '../ports/whatsapp-channel.repository.js';
import { WebhookVerification } from '../webhooks.js';

/** A new verify token, for when the first one was lost before registering the webhook. */
@Injectable()
export class RotateVerifyTokenUseCase {
  constructor(
    private readonly channels: WhatsAppChannelRepository,
    private readonly webhooks: WebhookVerification,
  ) {}

  /** @throws WhatsAppChannelNotFoundError, InsufficientRoleError */
  async execute(principal: Principal, id: string): Promise<string> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const verify = this.webhooks.newToken();
    if (!(await this.channels.setVerifyTokenHash(accountId, id, verify.hash))) {
      throw new WhatsAppChannelNotFoundError();
    }
    return verify.token;
  }
}
