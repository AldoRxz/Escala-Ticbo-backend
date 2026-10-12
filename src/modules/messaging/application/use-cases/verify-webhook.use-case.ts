import { Injectable } from '@nestjs/common';
import { WebhookVerificationFailedError } from '../errors.js';
import { WhatsAppChannelRepository } from '../ports/whatsapp-channel.repository.js';
import { WebhookVerification } from '../webhook-verification.js';

export interface VerificationRequest {
  mode: string | undefined;
  token: string | undefined;
  challenge: string | undefined;
}

/**
 * The subscription handshake from Meta: a GET with hub.mode=subscribe, the
 * verify token and a challenge to echo back. A match activates the channel.
 */
@Injectable()
export class VerifyWebhookUseCase {
  constructor(
    private readonly channels: WhatsAppChannelRepository,
    private readonly webhooks: WebhookVerification,
  ) {}

  /** @throws WebhookVerificationFailedError */
  async execute(channelId: string, request: VerificationRequest): Promise<string> {
    const channel = await this.channels.findForWebhook(channelId);
    if (
      !channel ||
      channel.status === 'disabled' ||
      request.mode !== 'subscribe' ||
      !request.token ||
      request.challenge === undefined ||
      !channel.verifyTokenHash ||
      !this.webhooks.matches(request.token, channel.verifyTokenHash)
    ) {
      throw new WebhookVerificationFailedError();
    }
    if (channel.status === 'pending_verification') {
      await this.channels.markActive(channel.id);
    }
    return request.challenge;
  }
}
