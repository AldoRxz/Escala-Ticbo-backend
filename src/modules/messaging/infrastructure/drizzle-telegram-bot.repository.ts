import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  type Database,
  DATABASE,
} from '../../../shared/infrastructure/database/database.tokens.js';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../../../shared/infrastructure/database/pg-errors.js';
import {
  telegramBots,
  telegramSenders,
} from '../../../shared/infrastructure/database/schema/index.js';
import {
  TelegramBotAlreadyConnectedError,
  TelegramSenderAlreadyAuthorizedError,
} from '../application/errors.js';
import { type SenderChanges, UnknownFiscalProfileError } from '../application/ports/senders.js';
import type {
  ChatSender,
  NewBot,
  NewTelegramSender,
  TelegramBotRepository,
  WebhookBot,
} from '../application/ports/telegram-bot.repository.js';
import type { TelegramBot, TelegramSender } from '../domain/telegram.js';

type BotRow = typeof telegramBots.$inferSelect;
type SenderRow = typeof telegramSenders.$inferSelect;

function toSender(row: SenderRow): TelegramSender {
  return {
    id: row.id,
    botId: row.botId,
    phone: row.phone,
    label: row.label,
    defaultFiscalProfileId: row.defaultFiscalProfileId,
    linkedAt: row.linkedAt,
    createdAt: row.createdAt,
  };
}

function toBot(row: BotRow, senders: SenderRow[]): TelegramBot {
  return {
    id: row.id,
    accountId: row.accountId,
    botUserId: row.botUserId,
    username: row.username,
    displayName: row.displayName,
    status: row.status,
    createdAt: row.createdAt,
    senders: senders.filter((sender) => sender.botId === row.id).map(toSender),
  };
}

function toChatSender(row: SenderRow): ChatSender {
  return { id: row.id, label: row.label, defaultFiscalProfileId: row.defaultFiscalProfileId };
}

function senderError(error: unknown): unknown {
  if (isUniqueViolation(error, 'telegram_senders_bot_phone_key')) {
    return new TelegramSenderAlreadyAuthorizedError();
  }
  if (isForeignKeyViolation(error, 'telegram_senders_default_profile_fk')) {
    return new UnknownFiscalProfileError();
  }
  return error;
}

// Control-plane tables: row-level security lets the API role see every row, so
// each account-facing query filters by account_id itself.
@Injectable()
export class DrizzleTelegramBotRepository implements TelegramBotRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(accountId: string): Promise<TelegramBot[]> {
    const bots = await this.db
      .select()
      .from(telegramBots)
      .where(eq(telegramBots.accountId, accountId))
      .orderBy(asc(telegramBots.createdAt));
    return this.withSenders(accountId, bots);
  }

  async find(accountId: string, id: string): Promise<TelegramBot | null> {
    const bots = await this.db
      .select()
      .from(telegramBots)
      .where(and(eq(telegramBots.id, id), eq(telegramBots.accountId, accountId)))
      .limit(1);
    const [bot] = await this.withSenders(accountId, bots);
    return bot ?? null;
  }

  async tokenSecretOf(accountId: string, id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ tokenSecretId: telegramBots.tokenSecretId })
      .from(telegramBots)
      .where(and(eq(telegramBots.id, id), eq(telegramBots.accountId, accountId)))
      .limit(1);
    return row?.tokenSecretId ?? null;
  }

  async insert(bot: NewBot): Promise<TelegramBot> {
    try {
      const [row] = await this.db.insert(telegramBots).values(bot).returning();
      return toBot(row!, []);
    } catch (error) {
      if (isUniqueViolation(error, 'telegram_bots_bot_user_id_key')) {
        throw new TelegramBotAlreadyConnectedError();
      }
      throw error;
    }
  }

  async delete(accountId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(telegramBots)
      .where(and(eq(telegramBots.id, id), eq(telegramBots.accountId, accountId)))
      .returning({ id: telegramBots.id });
    return rows.length > 0;
  }

  async findForWebhook(id: string): Promise<WebhookBot | null> {
    const [row] = await this.db
      .select({
        id: telegramBots.id,
        accountId: telegramBots.accountId,
        botUserId: telegramBots.botUserId,
        username: telegramBots.username,
        tokenSecretId: telegramBots.tokenSecretId,
        webhookSecretHash: telegramBots.webhookSecretHash,
        status: telegramBots.status,
      })
      .from(telegramBots)
      .where(eq(telegramBots.id, id))
      .limit(1);
    return row ?? null;
  }

  async addSender(sender: NewTelegramSender): Promise<TelegramSender> {
    try {
      const [row] = await this.db.insert(telegramSenders).values(sender).returning();
      return toSender(row!);
    } catch (error) {
      throw senderError(error);
    }
  }

  async updateSender(
    accountId: string,
    botId: string,
    senderId: string,
    changes: SenderChanges,
  ): Promise<TelegramSender | null> {
    const match = and(
      eq(telegramSenders.id, senderId),
      eq(telegramSenders.botId, botId),
      eq(telegramSenders.accountId, accountId),
    );
    try {
      const [row] =
        Object.keys(changes).length === 0
          ? await this.db.select().from(telegramSenders).where(match).limit(1)
          : await this.db.update(telegramSenders).set(changes).where(match).returning();
      return row ? toSender(row) : null;
    } catch (error) {
      throw senderError(error);
    }
  }

  async removeSender(accountId: string, botId: string, senderId: string): Promise<boolean> {
    const rows = await this.db
      .delete(telegramSenders)
      .where(
        and(
          eq(telegramSenders.id, senderId),
          eq(telegramSenders.botId, botId),
          eq(telegramSenders.accountId, accountId),
        ),
      )
      .returning({ id: telegramSenders.id });
    return rows.length > 0;
  }

  async findSenderByUser(botId: string, telegramUserId: number): Promise<ChatSender | null> {
    const [row] = await this.db
      .select()
      .from(telegramSenders)
      .where(
        and(eq(telegramSenders.botId, botId), eq(telegramSenders.telegramUserId, telegramUserId)),
      )
      .limit(1);
    return row ? toChatSender(row) : null;
  }

  async linkSender(
    botId: string,
    phones: string[],
    telegramUserId: number,
    at: Date,
  ): Promise<ChatSender | null> {
    return this.db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: telegramSenders.id })
        .from(telegramSenders)
        .where(and(eq(telegramSenders.botId, botId), inArray(telegramSenders.phone, phones)))
        .orderBy(asc(telegramSenders.createdAt))
        .limit(1)
        .for('update');
      if (!target) {
        return null;
      }
      // One Telegram user per bot: a person who changed numbers leaves the old one.
      await tx
        .update(telegramSenders)
        .set({ telegramUserId: null, linkedAt: null })
        .where(
          and(
            eq(telegramSenders.botId, botId),
            eq(telegramSenders.telegramUserId, telegramUserId),
            ne(telegramSenders.id, target.id),
          ),
        );
      const [row] = await tx
        .update(telegramSenders)
        .set({ telegramUserId, linkedAt: at })
        .where(eq(telegramSenders.id, target.id))
        .returning();
      return toChatSender(row!);
    });
  }

  private async withSenders(accountId: string, bots: BotRow[]): Promise<TelegramBot[]> {
    if (bots.length === 0) {
      return [];
    }
    const senders = await this.db
      .select()
      .from(telegramSenders)
      .where(
        and(
          eq(telegramSenders.accountId, accountId),
          inArray(
            telegramSenders.botId,
            bots.map((bot) => bot.id),
          ),
        ),
      )
      .orderBy(asc(telegramSenders.createdAt));
    return bots.map((bot) => toBot(bot, senders));
  }
}
