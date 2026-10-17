import { Injectable, Logger } from '@nestjs/common';
import { InvalidInputError, type ValidationIssue } from '../../../../shared/domain/app-error.js';
import { newId } from '../../../../shared/domain/id.js';
import {
  ACCOUNT_MANAGERS,
  activeAccountOf,
  requireRole,
} from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import { SecretVault } from '../../../vault/application/secret-vault.js';
import { normalizePhoneDigits } from '../../domain/phone.js';
import { normalizeSenderLabel } from '../../domain/sender.js';
import { parseBotToken, type TelegramBot, type TelegramSender } from '../../domain/telegram.js';
import { TelegramBotNotFoundError, TelegramSenderNotFoundError } from '../errors.js';
import { type SenderChanges, UnknownFiscalProfileError } from '../ports/senders.js';
import { type BotProfile, TelegramApi, TelegramTokenRejectedError } from '../ports/telegram-api.js';
import { TelegramBotRepository } from '../ports/telegram-bot.repository.js';
import { TelegramWebhooks } from '../webhooks.js';

/** The account's Telegram bots and their authorized phones; any member can see them. */
@Injectable()
export class ListTelegramBotsUseCase {
  constructor(private readonly bots: TelegramBotRepository) {}

  async execute(principal: Principal): Promise<TelegramBot[]> {
    return this.bots.list(activeAccountOf(principal));
  }
}

/**
 * Connects a bot from its @BotFather token: Telegram confirms the token, the
 * token goes to the vault and Ticbo registers the webhook itself, so the bot
 * works right away.
 */
@Injectable()
export class ConnectTelegramBotUseCase {
  private readonly logger = new Logger(ConnectTelegramBotUseCase.name);

  constructor(
    private readonly bots: TelegramBotRepository,
    private readonly telegram: TelegramApi,
    private readonly vault: SecretVault,
    private readonly webhooks: TelegramWebhooks,
  ) {}

  /**
   * @throws InvalidInputError, TelegramBotAlreadyConnectedError, TelegramUnavailableError,
   *   InsufficientRoleError
   */
  async execute(principal: Principal, input: { token: string }): Promise<TelegramBot> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const parsed = parseBotToken(input.token);
    if (!parsed) {
      throw new InvalidInputError([
        {
          path: 'token',
          code: 'invalid_bot_token',
          message: 'Paste the whole token @BotFather gave you.',
        },
      ]);
    }
    const profile = await this.profileOf(parsed.token);

    const tokenSecretId = await this.vault.store(accountId, 'telegram_bot_token', parsed.token);
    const secret = this.webhooks.newSecret();
    let bot: TelegramBot;
    try {
      bot = await this.bots.insert({
        id: newId(),
        accountId,
        botUserId: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        tokenSecretId,
        webhookSecretHash: secret.hash,
      });
    } catch (error) {
      // Already connected (here or in another account): its webhook is left alone.
      await this.forget(accountId, tokenSecretId);
      throw error;
    }

    try {
      await this.telegram.setWebhook(parsed.token, this.webhooks.urlFor(bot.id), secret.token);
    } catch (error) {
      await this.bots.delete(accountId, bot.id);
      await this.forget(accountId, tokenSecretId);
      throw error;
    }
    return bot;
  }

  private async profileOf(token: string): Promise<BotProfile> {
    try {
      return await this.telegram.getMe(token);
    } catch (error) {
      if (error instanceof TelegramTokenRejectedError) {
        throw new InvalidInputError([
          {
            path: 'token',
            code: 'bot_token_rejected',
            message: 'Telegram does not recognize this token. Copy it again from @BotFather.',
          },
        ]);
      }
      throw error;
    }
  }

  private async forget(accountId: string, secretId: string): Promise<void> {
    try {
      await this.vault.remove(accountId, secretId);
    } catch {
      this.logger.warn(`Could not delete the token ${secretId} of a bot that did not connect`);
    }
  }
}

/** Disconnects a bot: Telegram stops sending it to Ticbo, and its senders and token go away. */
@Injectable()
export class DisconnectTelegramBotUseCase {
  private readonly logger = new Logger(DisconnectTelegramBotUseCase.name);

  constructor(
    private readonly bots: TelegramBotRepository,
    private readonly telegram: TelegramApi,
    private readonly vault: SecretVault,
  ) {}

  /** @throws TelegramBotNotFoundError, InsufficientRoleError */
  async execute(principal: Principal, id: string): Promise<void> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const tokenSecretId = await this.bots.tokenSecretOf(accountId, id);
    if (!tokenSecretId) {
      throw new TelegramBotNotFoundError();
    }
    const token = await this.vault.reveal(accountId, tokenSecretId).catch(() => null);
    if (!(await this.bots.delete(accountId, id))) {
      token?.fill(0);
      throw new TelegramBotNotFoundError();
    }

    if (token) {
      try {
        await this.telegram.deleteWebhook(token.toString('utf8'));
      } catch {
        // The bot is gone from Ticbo either way; its updates now get a 404.
        this.logger.warn(`Could not remove the webhook of Telegram bot ${id}`);
      } finally {
        token.fill(0);
      }
    }
    try {
      await this.vault.remove(accountId, tokenSecretId);
    } catch {
      this.logger.warn(`Could not delete the token of Telegram bot ${id}`);
    }
  }
}

export interface TelegramSenderInput {
  phone: string;
  label?: string | null;
  defaultFiscalProfileId?: string | null;
}

const unknownProfile: ValidationIssue = {
  path: 'defaultFiscalProfileId',
  code: 'unknown_fiscal_profile',
  message: 'Choose an RFC registered in this account.',
};

/** Authorizes a phone; the person then shares their contact with the bot to start. */
@Injectable()
export class AddTelegramSenderUseCase {
  constructor(private readonly bots: TelegramBotRepository) {}

  /** @throws InvalidInputError, TelegramBotNotFoundError, TelegramSenderAlreadyAuthorizedError */
  async execute(
    principal: Principal,
    botId: string,
    input: TelegramSenderInput,
  ): Promise<TelegramSender> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const phone = normalizePhoneDigits(input.phone);
    if (!phone) {
      throw new InvalidInputError([
        { path: 'phone', code: 'invalid_phone', message: 'Type the number with its country code.' },
      ]);
    }
    if (!(await this.bots.find(accountId, botId))) {
      throw new TelegramBotNotFoundError();
    }
    try {
      return await this.bots.addSender({
        id: newId(),
        accountId,
        botId,
        phone,
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
export class UpdateTelegramSenderUseCase {
  constructor(private readonly bots: TelegramBotRepository) {}

  /** @throws InvalidInputError, TelegramSenderNotFoundError, InsufficientRoleError */
  async execute(
    principal: Principal,
    botId: string,
    senderId: string,
    input: Omit<TelegramSenderInput, 'phone'>,
  ): Promise<TelegramSender> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    const changes: SenderChanges = {};
    if (input.label !== undefined) {
      changes.label = normalizeSenderLabel(input.label);
    }
    if (input.defaultFiscalProfileId !== undefined) {
      changes.defaultFiscalProfileId = input.defaultFiscalProfileId;
    }
    let sender: TelegramSender | null;
    try {
      sender = await this.bots.updateSender(accountId, botId, senderId, changes);
    } catch (error) {
      if (error instanceof UnknownFiscalProfileError) {
        throw new InvalidInputError([unknownProfile]);
      }
      throw error;
    }
    if (!sender) {
      throw new TelegramSenderNotFoundError();
    }
    return sender;
  }
}

/** Revokes the permission of a phone to send receipts to the bot. */
@Injectable()
export class RemoveTelegramSenderUseCase {
  constructor(private readonly bots: TelegramBotRepository) {}

  /** @throws TelegramSenderNotFoundError, InsufficientRoleError */
  async execute(principal: Principal, botId: string, senderId: string): Promise<void> {
    const accountId = requireRole(principal, ACCOUNT_MANAGERS);
    if (!(await this.bots.removeSender(accountId, botId, senderId))) {
      throw new TelegramSenderNotFoundError();
    }
  }
}
