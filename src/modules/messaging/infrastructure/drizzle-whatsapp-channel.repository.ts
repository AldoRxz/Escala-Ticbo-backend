import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  type Database,
  DATABASE,
} from '../../../shared/infrastructure/database/database.tokens.js';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../../../shared/infrastructure/database/pg-errors.js';
import {
  whatsappChannels,
  whatsappSenders,
} from '../../../shared/infrastructure/database/schema/index.js';
import {
  WhatsAppNumberAlreadyConnectedError,
  WhatsAppSenderAlreadyAuthorizedError,
} from '../application/errors.js';
import { type SenderChanges, UnknownFiscalProfileError } from '../application/ports/senders.js';
import type {
  ChatWhatsAppSender,
  NewChannel,
  NewSender,
  RemovedChannel,
  WebhookChannel,
  WhatsAppChannelRepository,
} from '../application/ports/whatsapp-channel.repository.js';
import type { WhatsAppChannel, WhatsAppSender } from '../domain/whatsapp.js';

type ChannelRow = typeof whatsappChannels.$inferSelect;
type SenderRow = typeof whatsappSenders.$inferSelect;

function toSender(row: SenderRow): WhatsAppSender {
  return {
    id: row.id,
    channelId: row.channelId,
    waId: row.waId,
    label: row.label,
    defaultFiscalProfileId: row.defaultFiscalProfileId,
    createdAt: row.createdAt,
  };
}

function toChannel(row: ChannelRow, senders: SenderRow[]): WhatsAppChannel {
  return {
    id: row.id,
    accountId: row.accountId!,
    phoneNumberId: row.phoneNumberId,
    businessAccountId: row.businessAccountId,
    displayPhoneNumber: row.displayPhoneNumber,
    status: row.status,
    createdAt: row.createdAt,
    senders: senders.filter((sender) => sender.channelId === row.id).map(toSender),
  };
}

function senderError(error: unknown): unknown {
  if (isUniqueViolation(error, 'whatsapp_senders_channel_wa_id_key')) {
    return new WhatsAppSenderAlreadyAuthorizedError();
  }
  if (isForeignKeyViolation(error, 'whatsapp_senders_default_profile_fk')) {
    return new UnknownFiscalProfileError();
  }
  return error;
}

// Control-plane tables: row-level security lets the API role see every row, so
// each account-facing query filters by account_id itself.
@Injectable()
export class DrizzleWhatsAppChannelRepository implements WhatsAppChannelRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(accountId: string): Promise<WhatsAppChannel[]> {
    const channels = await this.db
      .select()
      .from(whatsappChannels)
      .where(eq(whatsappChannels.accountId, accountId))
      .orderBy(asc(whatsappChannels.createdAt));
    return this.withSenders(accountId, channels);
  }

  async find(accountId: string, id: string): Promise<WhatsAppChannel | null> {
    const channels = await this.db
      .select()
      .from(whatsappChannels)
      .where(and(eq(whatsappChannels.id, id), eq(whatsappChannels.accountId, accountId)))
      .limit(1);
    const [channel] = await this.withSenders(accountId, channels);
    return channel ?? null;
  }

  async insert(channel: NewChannel): Promise<WhatsAppChannel> {
    try {
      const [row] = await this.db.insert(whatsappChannels).values(channel).returning();
      return toChannel(row!, []);
    } catch (error) {
      if (isUniqueViolation(error, 'whatsapp_channels_phone_number_id_key')) {
        throw new WhatsAppNumberAlreadyConnectedError();
      }
      throw error;
    }
  }

  async delete(accountId: string, id: string): Promise<RemovedChannel | null> {
    const [row] = await this.db
      .delete(whatsappChannels)
      .where(and(eq(whatsappChannels.id, id), eq(whatsappChannels.accountId, accountId)))
      .returning({
        accessTokenSecretId: whatsappChannels.accessTokenSecretId,
        appSecretSecretId: whatsappChannels.appSecretSecretId,
      });
    return row ?? null;
  }

  async setVerifyTokenHash(accountId: string, id: string, hash: string): Promise<boolean> {
    const rows = await this.db
      .update(whatsappChannels)
      .set({ verifyTokenHash: hash })
      .where(and(eq(whatsappChannels.id, id), eq(whatsappChannels.accountId, accountId)))
      .returning({ id: whatsappChannels.id });
    return rows.length > 0;
  }

  async findForWebhook(id: string): Promise<WebhookChannel | null> {
    const [row] = await this.db
      .select({
        id: whatsappChannels.id,
        accountId: whatsappChannels.accountId,
        phoneNumberId: whatsappChannels.phoneNumberId,
        status: whatsappChannels.status,
        verifyTokenHash: whatsappChannels.verifyTokenHash,
        accessTokenSecretId: whatsappChannels.accessTokenSecretId,
        appSecretSecretId: whatsappChannels.appSecretSecretId,
      })
      .from(whatsappChannels)
      .where(eq(whatsappChannels.id, id))
      .limit(1);
    return row ?? null;
  }

  async markActive(id: string): Promise<void> {
    await this.db
      .update(whatsappChannels)
      .set({ status: 'active' })
      .where(and(eq(whatsappChannels.id, id), eq(whatsappChannels.status, 'pending_verification')));
  }

  async findSender(channelId: string, waIds: string[]): Promise<ChatWhatsAppSender | null> {
    const [row] = await this.db
      .select({
        id: whatsappSenders.id,
        waId: whatsappSenders.waId,
        label: whatsappSenders.label,
        defaultFiscalProfileId: whatsappSenders.defaultFiscalProfileId,
      })
      .from(whatsappSenders)
      .where(and(eq(whatsappSenders.channelId, channelId), inArray(whatsappSenders.waId, waIds)))
      .orderBy(asc(whatsappSenders.createdAt))
      .limit(1);
    return row ?? null;
  }

  async addSender(sender: NewSender): Promise<WhatsAppSender> {
    try {
      const [row] = await this.db.insert(whatsappSenders).values(sender).returning();
      return toSender(row!);
    } catch (error) {
      throw senderError(error);
    }
  }

  async updateSender(
    accountId: string,
    channelId: string,
    senderId: string,
    changes: SenderChanges,
  ): Promise<WhatsAppSender | null> {
    const match = and(
      eq(whatsappSenders.id, senderId),
      eq(whatsappSenders.channelId, channelId),
      eq(whatsappSenders.accountId, accountId),
    );
    try {
      const [row] =
        Object.keys(changes).length === 0
          ? await this.db.select().from(whatsappSenders).where(match).limit(1)
          : await this.db.update(whatsappSenders).set(changes).where(match).returning();
      return row ? toSender(row) : null;
    } catch (error) {
      throw senderError(error);
    }
  }

  async removeSender(accountId: string, channelId: string, senderId: string): Promise<boolean> {
    const rows = await this.db
      .delete(whatsappSenders)
      .where(
        and(
          eq(whatsappSenders.id, senderId),
          eq(whatsappSenders.channelId, channelId),
          eq(whatsappSenders.accountId, accountId),
        ),
      )
      .returning({ id: whatsappSenders.id });
    return rows.length > 0;
  }

  private async withSenders(accountId: string, channels: ChannelRow[]): Promise<WhatsAppChannel[]> {
    if (channels.length === 0) {
      return [];
    }
    const senders = await this.db
      .select()
      .from(whatsappSenders)
      .where(
        and(
          eq(whatsappSenders.accountId, accountId),
          inArray(
            whatsappSenders.channelId,
            channels.map((channel) => channel.id),
          ),
        ),
      )
      .orderBy(asc(whatsappSenders.createdAt));
    return channels.map((channel) => toChannel(channel, senders));
  }
}
