export type TelegramBotStatus = 'active' | 'disabled';

/** A bot the customer created with @BotFather and connected to Ticbo. */
export interface TelegramBot {
  readonly id: string;
  readonly accountId: string;
  /** Telegram's numeric id of the bot. */
  readonly botUserId: number;
  /** Without the @. */
  readonly username: string;
  readonly displayName: string;
  readonly status: TelegramBotStatus;
  readonly createdAt: Date;
  readonly senders: readonly TelegramSender[];
}

/** A phone allowed to send receipts to a bot. */
export interface TelegramSender {
  readonly id: string;
  readonly botId: string;
  /** Country code and number, digits only. */
  readonly phone: string;
  readonly label: string | null;
  readonly defaultFiscalProfileId: string | null;
  /** When the person shared their contact with the bot; null until then. */
  readonly linkedAt: Date | null;
  readonly createdAt: Date;
}

// <bot id>:<secret>, as @BotFather hands it out, e.g. 123456789:AAH…
const BOT_TOKEN = /^([0-9]{5,16}):[A-Za-z0-9_-]{30,64}$/;

/** The token without spaces and the bot id it carries, or null when it is not a bot token. */
export function parseBotToken(input: string): { token: string; botUserId: number } | null {
  const token = input.trim();
  const match = BOT_TOKEN.exec(token);
  return match ? { token, botUserId: Number(match[1]) } : null;
}

/** Link that opens a chat with the bot. */
export function botLink(username: string): string {
  return `https://t.me/${username}`;
}
