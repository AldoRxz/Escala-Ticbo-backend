import { Injectable, Logger } from '@nestjs/common';
import { ACCOUNT_MANAGERS, requireRole } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import { SecretVault } from '../../../vault/application/secret-vault.js';
import { WhatsAppChannelNotFoundError } from '../errors.js';
import { WhatsAppChannelRepository } from '../ports/whatsapp-channel.repository.js';

/** Disconnects a number: its senders go with it and its credentials are deleted. */
@Injectable()
export class DisconnectWhatsAppChannelUseCase {
  private readonly logger = new Logger(DisconnectWhatsAppChannelUseCase.name);

  constructor(
    private readonly channels: WhatsAppChannelRepository,
    private readonly vault: SecretVault,
  ) {}

  /** @throws WhatsAppChannelNotFoundError, InsufficientRoleError */
  async execute(principal: Principal, id: string): Promise<void> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const removed = await this.channels.delete(accountId, id);
    if (!removed) {
      throw new WhatsAppChannelNotFoundError();
    }
    const secretIds = [removed.accessTokenSecretId, removed.appSecretSecretId].filter(
      (secretId): secretId is string => secretId !== null,
    );
    const results = await Promise.allSettled(
      secretIds.map((secretId) => this.vault.remove(accountId, secretId)),
    );
    if (results.some((result) => result.status === 'rejected')) {
      // The channel is gone either way; a leftover secret is unreachable but should be swept.
      this.logger.warn(`Could not delete every credential of WhatsApp channel ${id}`);
    }
  }
}
