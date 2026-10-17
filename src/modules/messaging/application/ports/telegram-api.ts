/** The bot as Telegram describes it. */
export interface BotProfile {
  id: number;
  /** Without the @. */
  username: string;
  displayName: string;
}

/** Keyboard under a message: a button that shares the person's own number, or none at all. */
export type ReplyKeyboard = { kind: 'share_contact'; label: string } | { kind: 'remove' };

/** Telegram does not recognize the token (revoked, or never issued). */
export class TelegramTokenRejectedError extends Error {}

/** The file is larger than the caller accepts. */
export class TelegramFileTooLargeError extends Error {}

/**
 * Telegram's Bot API. Every call takes the bot's token: each customer brings
 * their own bot, so there is no Ticbo-wide token.
 * Failures to reach Telegram throw TelegramUnavailableError.
 */
export abstract class TelegramApi {
  /** @throws TelegramTokenRejectedError */
  abstract getMe(token: string): Promise<BotProfile>;

  /** Points the bot's updates at `url`; Telegram sends `secretToken` back in a header. */
  abstract setWebhook(token: string, url: string, secretToken: string): Promise<void>;

  abstract deleteWebhook(token: string): Promise<void>;

  abstract sendMessage(
    token: string,
    chatId: number,
    text: string,
    keyboard?: ReplyKeyboard,
  ): Promise<void>;

  /** @throws TelegramFileTooLargeError */
  abstract downloadFile(token: string, fileId: string, maxBytes: number): Promise<Buffer>;
}
