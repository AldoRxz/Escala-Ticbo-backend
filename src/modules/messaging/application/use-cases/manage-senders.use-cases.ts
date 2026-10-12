import { Injectable } from '@nestjs/common';
import { InvalidInputError, type ValidationIssue } from '../../../../shared/domain/app-error.js';
import { newId } from '../../../../shared/domain/id.js';
import { ACCOUNT_MANAGERS, requireRole } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import {
  normalizePhoneDigits,
  normalizeSenderLabel,
  type WhatsAppSender,
} from '../../domain/whatsapp.js';
import { WhatsAppChannelNotFoundError, WhatsAppSenderNotFoundError } from '../errors.js';
import {
  type SenderChanges,
  UnknownFiscalProfileError,
  WhatsAppChannelRepository,
} from '../ports/whatsapp-channel.repository.js';

export interface SenderInput {
  waId: string;
  label?: string | null;
  defaultFiscalProfileId?: string | null;
}

const unknownProfile: ValidationIssue = {
  path: 'defaultFiscalProfileId',
  code: 'unknown_fiscal_profile',
  message: 'Choose an RFC registered in this account.',
};

/** Authorizes a phone to send receipts to one of the account's numbers. */
@Injectable()
export class AddSenderUseCase {
  constructor(private readonly channels: WhatsAppChannelRepository) {}

  /** @throws InvalidInputError, WhatsAppChannelNotFoundError, WhatsAppSenderAlreadyAuthorizedError */
  async execute(
    principal: Principal,
    channelId: string,
    input: SenderInput,
  ): Promise<WhatsAppSender> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const waId = normalizePhoneDigits(input.waId);
    if (!waId) {
      throw new InvalidInputError([
        { path: 'waId', code: 'invalid_phone', message: 'Type the number with its country code.' },
      ]);
    }
    if (!(await this.channels.find(accountId, channelId))) {
      throw new WhatsAppChannelNotFoundError();
    }
    try {
      return await this.channels.addSender({
        id: newId(),
        accountId,
        channelId,
        waId,
        label: normalizeSenderLabel(input.label),
        defaultFiscalProfileId: input.defaultFiscalProfileId ?? null,
      });
    } catch (error) {
      if (error instanceof UnknownFiscalProfileError) {
        throw new InvalidInputError([unknownProfile]);
      }
      throw error;
    }
  }
}

/** Renames a sender or changes the RFC their receipts are invoiced to by default. */
@Injectable()
export class UpdateSenderUseCase {
  constructor(private readonly channels: WhatsAppChannelRepository) {}

  /** @throws InvalidInputError, WhatsAppSenderNotFoundError, InsufficientRoleError */
  async execute(
    principal: Principal,
    channelId: string,
    senderId: string,
    input: Omit<SenderInput, 'waId'>,
  ): Promise<WhatsAppSender> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const changes: SenderChanges = {};
    if (input.label !== undefined) {
      changes.label = normalizeSenderLabel(input.label);
    }
    if (input.defaultFiscalProfileId !== undefined) {
      changes.defaultFiscalProfileId = input.defaultFiscalProfileId;
    }
    let sender: WhatsAppSender | null;
    try {
      sender = await this.channels.updateSender(accountId, channelId, senderId, changes);
    } catch (error) {
      if (error instanceof UnknownFiscalProfileError) {
        throw new InvalidInputError([unknownProfile]);
      }
      throw error;
    }
    if (!sender) {
      throw new WhatsAppSenderNotFoundError();
    }
    return sender;
  }
}

/** Revokes the permission of a phone to send receipts. */
@Injectable()
export class RemoveSenderUseCase {
  constructor(private readonly channels: WhatsAppChannelRepository) {}

  /** @throws WhatsAppSenderNotFoundError, InsufficientRoleError */
  async execute(principal: Principal, channelId: string, senderId: string): Promise<void> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    if (!(await this.channels.removeSender(accountId, channelId, senderId))) {
      throw new WhatsAppSenderNotFoundError();
    }
  }
}
