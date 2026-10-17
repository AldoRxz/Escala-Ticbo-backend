import type { TelegramBot, TelegramBotStatus, TelegramSender } from '../../domain/telegram.js';
import type { SenderChanges } from './senders.js';

export interface NewBot {
  id: string;
  accountId: string;
  botUserId: number;
  username: string;
  displayName: string;
  tokenSecretId: string;
  webhookSecretHash: string;
}

/** What the webhook needs before the tenant is known. */
export interface WebhookBot {
  id: string;
  accountId: string;
  botUserId: number;
  username: string;
  tokenSecretId: string;
  webhookSecretHash: string;
  status: TelegramBotStatus;
}

export interface NewTelegramSender {
  id: string;
  accountId: string;
  botId: string;
  phone: string;
  label: string | null;
  defaultFiscalProfileId: string | null;
}

/** A linked sender, as the webhook sees it. */
export interface ChatSender {
  id: string;
  label: string | null;
  defaultFiscalProfileId: string | null;
}

/**
 * Telegram bots and their senders. Like the WhatsApp tables, these are routing
 * data read before a tenant is known, so every account-facing method takes the
 * account and must filter by it.
 */
export abstract class TelegramBotRepository {
  abstract list(accountId: string): Promise<TelegramBot[]>;

  abstract find(accountId: string, id: string): Promise<TelegramBot | null>;

  /** The vault reference of the bot's token, to reveal it before disconnecting. */
  abstract tokenSecretOf(accountId: string, id: string): Promise<string | null>;

  /** @throws TelegramBotAlreadyConnectedError */
  abstract insert(bot: NewBot): Promise<TelegramBot>;

  /** Deletes the bot and its senders; false when it is not in the account. */
  abstract delete(accountId: string, id: string): Promise<boolean>;

  abstract findForWebhook(id: string): Promise<WebhookBot | null>;

  /** @throws TelegramSenderAlreadyAuthorizedError, UnknownFiscalProfileError */
  abstract addSender(sender: NewTelegramSender): Promise<TelegramSender>;

  /** Null when the sender does not exist on that bot of the account. @throws UnknownFiscalProfileError */
  abstract updateSender(
    accountId: string,
    botId: string,
    senderId: string,
    changes: SenderChanges,
  ): Promise<TelegramSender | null>;

  abstract removeSender(accountId: string, botId: string, senderId: string): Promise<boolean>;

  abstract findSenderByUser(botId: string, telegramUserId: number): Promise<ChatSender | null>;

  /**
   * Links the sender authorized with any of `phones` to the Telegram user, who
   * proved the number is theirs by sharing their own contact. A user linked to
   * another phone of the same bot is moved to this one. Null when no phone matches.
   */
  abstract linkSender(
    botId: string,
    phones: string[],
    telegramUserId: number,
    at: Date,
  ): Promise<ChatSender | null>;
}
