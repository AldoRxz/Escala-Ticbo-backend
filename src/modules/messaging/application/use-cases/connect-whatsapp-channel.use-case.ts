import { Injectable } from '@nestjs/common';
import { InvalidInputError } from '../../../../shared/domain/app-error.js';
import { newId } from '../../../../shared/domain/id.js';
import { ACCOUNT_MANAGERS, requireRole } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import { SecretVault } from '../../../vault/application/secret-vault.js';
import {
  type ChannelCredentials,
  validateCredentials,
  type WhatsAppChannel,
} from '../../domain/whatsapp.js';
import { WhatsAppChannelRepository } from '../ports/whatsapp-channel.repository.js';
import { WebhookVerification } from '../webhook-verification.js';

export interface ConnectedChannel {
  channel: WhatsAppChannel;
  /** Shown once: only its hash is stored. */
  verifyToken: string;
}

/**
 * Connects the customer's own WhatsApp Business number. The access token and
 * app secret go to the vault encrypted; the channel waits for Meta to verify
 * the webhook before it becomes active.
 */
@Injectable()
export class ConnectWhatsAppChannelUseCase {
  constructor(
    private readonly channels: WhatsAppChannelRepository,
    private readonly vault: SecretVault,
    private readonly webhooks: WebhookVerification,
  ) {}

  /** @throws InvalidInputError, WhatsAppNumberAlreadyConnectedError, InsufficientRoleError */
  async execute(principal: Principal, input: ChannelCredentials): Promise<ConnectedChannel> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const result = validateCredentials(input);
    if (!result.ok) {
      throw new InvalidInputError(result.issues);
    }
    const { accessToken, appSecret, ...numbers } = result.value;

    const accessTokenSecretId = await this.vault.store(
      accountId,
      'whatsapp_access_token',
      accessToken,
    );
    const appSecretSecretId = await this.vault.store(accountId, 'whatsapp_app_secret', appSecret);
    const verify = this.webhooks.newToken();
    try {
      const channel = await this.channels.insert({
        id: newId(),
        accountId,
        ...numbers,
        accessTokenSecretId,
        appSecretSecretId,
        verifyTokenHash: verify.hash,
      });
      return { channel, verifyToken: verify.token };
    } catch (error) {
      // No channel, no reason to keep its credentials.
      await Promise.allSettled([
        this.vault.remove(accountId, accessTokenSecretId),
        this.vault.remove(accountId, appSecretSecretId),
      ]);
      throw error;
    }
  }
}
