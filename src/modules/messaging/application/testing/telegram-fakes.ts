import type { TelegramBot, TelegramSender } from '../../domain/telegram.js';
import {
  TelegramBotAlreadyConnectedError,
  TelegramSenderAlreadyAuthorizedError,
  TelegramUnavailableError,
} from '../errors.js';
import type { SenderChanges } from '../ports/senders.js';
import {
  type BotProfile,
  type ReplyKeyboard,
  TelegramApi,
  TelegramFileTooLargeError,
  TelegramTokenRejectedError,
} from '../ports/telegram-api.js';
import type {
  ChatSender,
  NewBot,
  NewTelegramSender,
  TelegramBotRepository,
  WebhookBot,
} from '../ports/telegram-bot.repository.js';

type StoredBot = Omit<TelegramBot, 'senders'> & NewBot;
type StoredSender = TelegramSender & { accountId: string; telegramUserId: number | null };

export class InMemoryTelegramBotRepository implements TelegramBotRepository {
  readonly bots: StoredBot[] = [];
  readonly senders: StoredSender[] = [];

  private view(bot: StoredBot): TelegramBot {
    return {
      id: bot.id,
      accountId: bot.accountId,
      botUserId: bot.botUserId,
      username: bot.username,
      displayName: bot.displayName,
      status: bot.status,
      createdAt: bot.createdAt,
      senders: this.senders.filter((sender) => sender.botId === bot.id).map(senderView),
    };
  }

  list(accountId: string): Promise<TelegramBot[]> {
    return Promise.resolve(
      this.bots.filter((b) => b.accountId === accountId).map((b) => this.view(b)),
    );
  }

  find(accountId: string, id: string): Promise<TelegramBot | null> {
    const bot = this.bots.find((b) => b.accountId === accountId && b.id === id);
    return Promise.resolve(bot ? this.view(bot) : null);
  }

  tokenSecretOf(accountId: string, id: string): Promise<string | null> {
    const bot = this.bots.find((b) => b.accountId === accountId && b.id === id);
    return Promise.resolve(bot?.tokenSecretId ?? null);
  }

  insert(bot: NewBot): Promise<TelegramBot> {
    if (this.bots.some((b) => b.botUserId === bot.botUserId)) {
      return Promise.reject(new TelegramBotAlreadyConnectedError());
    }
    const stored: StoredBot = { ...bot, status: 'active', createdAt: new Date() };
    this.bots.push(stored);
    return Promise.resolve(this.view(stored));
  }

  delete(accountId: string, id: string): Promise<boolean> {
    const index = this.bots.findIndex((b) => b.accountId === accountId && b.id === id);
    if (index < 0) {
      return Promise.resolve(false);
    }
    this.bots.splice(index, 1);
    for (let i = this.senders.length - 1; i >= 0; i--) {
      if (this.senders[i]!.botId === id) {
        this.senders.splice(i, 1);
      }
    }
    return Promise.resolve(true);
  }

  findForWebhook(id: string): Promise<WebhookBot | null> {
    const bot = this.bots.find((b) => b.id === id);
    return Promise.resolve(
      bot
        ? {
            id: bot.id,
            accountId: bot.accountId,
            botUserId: bot.botUserId,
            username: bot.username,
            tokenSecretId: bot.tokenSecretId,
            webhookSecretHash: bot.webhookSecretHash,
            status: bot.status,
          }
        : null,
    );
  }

  addSender(sender: NewTelegramSender): Promise<TelegramSender> {
    if (this.senders.some((s) => s.botId === sender.botId && s.phone === sender.phone)) {
      return Promise.reject(new TelegramSenderAlreadyAuthorizedError());
    }
    const stored: StoredSender = {
      ...sender,
      telegramUserId: null,
      linkedAt: null,
      createdAt: new Date(),
    };
    this.senders.push(stored);
    return Promise.resolve(senderView(stored));
  }

  updateSender(
    accountId: string,
    botId: string,
    senderId: string,
    changes: SenderChanges,
  ): Promise<TelegramSender | null> {
    const sender = this.senders.find(
      (s) => s.accountId === accountId && s.botId === botId && s.id === senderId,
    );
    if (!sender) {
      return Promise.resolve(null);
    }
    Object.assign(sender, changes);
    return Promise.resolve(senderView(sender));
  }

  removeSender(accountId: string, botId: string, senderId: string): Promise<boolean> {
    const index = this.senders.findIndex(
      (s) => s.accountId === accountId && s.botId === botId && s.id === senderId,
    );
    if (index >= 0) {
      this.senders.splice(index, 1);
    }
    return Promise.resolve(index >= 0);
  }

  findSenderByUser(botId: string, telegramUserId: number): Promise<ChatSender | null> {
    const sender = this.senders.find(
      (s) => s.botId === botId && s.telegramUserId === telegramUserId,
    );
    return Promise.resolve(sender ? chatView(sender) : null);
  }

  linkSender(
    botId: string,
    phones: string[],
    telegramUserId: number,
    at: Date,
  ): Promise<ChatSender | null> {
    const target = this.senders.find((s) => s.botId === botId && phones.includes(s.phone));
    if (!target) {
      return Promise.resolve(null);
    }
    for (const other of this.senders) {
      if (other.botId === botId && other.telegramUserId === telegramUserId && other !== target) {
        Object.assign(other, { telegramUserId: null, linkedAt: null });
      }
    }
    Object.assign(target, { telegramUserId, linkedAt: at });
    return Promise.resolve(chatView(target));
  }
}

function senderView(sender: StoredSender): TelegramSender {
  return {
    id: sender.id,
    botId: sender.botId,
    phone: sender.phone,
    label: sender.label,
    defaultFiscalProfileId: sender.defaultFiscalProfileId,
    linkedAt: sender.linkedAt,
    createdAt: sender.createdAt,
  };
}

function chatView(sender: StoredSender): ChatSender {
  return {
    id: sender.id,
    label: sender.label,
    defaultFiscalProfileId: sender.defaultFiscalProfileId,
  };
}

export interface SentMessage {
  token: string;
  chatId: number;
  text: string;
  keyboard?: ReplyKeyboard;
}

/** Telegram as a recording: one valid token, webhooks and messages kept in memory. */
export class FakeTelegramApi extends TelegramApi {
  readonly profiles = new Map<string, BotProfile>();
  readonly webhooks = new Map<string, { url: string; secretToken: string }>();
  readonly sent: SentMessage[] = [];
  readonly files = new Map<string, Buffer>();
  down = false;

  getMe(token: string): Promise<BotProfile> {
    if (this.down) {
      return Promise.reject(new TelegramUnavailableError());
    }
    const profile = this.profiles.get(token);
    return profile ? Promise.resolve(profile) : Promise.reject(new TelegramTokenRejectedError());
  }

  setWebhook(token: string, url: string, secretToken: string): Promise<void> {
    if (this.down) {
      return Promise.reject(new TelegramUnavailableError());
    }
    this.webhooks.set(token, { url, secretToken });
    return Promise.resolve();
  }

  deleteWebhook(token: string): Promise<void> {
    this.webhooks.delete(token);
    return Promise.resolve();
  }

  sendMessage(
    token: string,
    chatId: number,
    text: string,
    keyboard?: ReplyKeyboard,
  ): Promise<void> {
    this.sent.push({ token, chatId, text, ...(keyboard ? { keyboard } : {}) });
    return Promise.resolve();
  }

  downloadFile(_token: string, fileId: string, maxBytes: number): Promise<Buffer> {
    const file = this.files.get(fileId);
    if (!file) {
      return Promise.reject(new TelegramUnavailableError());
    }
    return file.length > maxBytes
      ? Promise.reject(new TelegramFileTooLargeError())
      : Promise.resolve(file);
  }
}
