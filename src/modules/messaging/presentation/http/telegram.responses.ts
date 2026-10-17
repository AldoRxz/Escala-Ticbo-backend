import {
  botLink,
  type TelegramBot,
  type TelegramBotStatus,
  type TelegramSender,
} from '../../domain/telegram.js';

export interface TelegramSenderResponse {
  id: string;
  phone: string;
  label: string | null;
  defaultFiscalProfileId: string | null;
  /** True once the person shared their contact with the bot. */
  linked: boolean;
  linkedAt: string | null;
  createdAt: string;
}

/** A connected bot. The token is never returned. */
export interface TelegramBotResponse {
  id: string;
  username: string;
  displayName: string;
  /** Opens a chat with the bot (t.me link). */
  link: string;
  status: TelegramBotStatus;
  createdAt: string;
  senders: TelegramSenderResponse[];
}

export function toTelegramSenderResponse(sender: TelegramSender): TelegramSenderResponse {
  return {
    id: sender.id,
    phone: sender.phone,
    label: sender.label,
    defaultFiscalProfileId: sender.defaultFiscalProfileId,
    linked: sender.linkedAt !== null,
    linkedAt: sender.linkedAt?.toISOString() ?? null,
    createdAt: sender.createdAt.toISOString(),
  };
}

export function toTelegramBotResponse(bot: TelegramBot): TelegramBotResponse {
  return {
    id: bot.id,
    username: bot.username,
    displayName: bot.displayName,
    link: botLink(bot.username),
    status: bot.status,
    createdAt: bot.createdAt.toISOString(),
    senders: bot.senders.map(toTelegramSenderResponse),
  };
}
