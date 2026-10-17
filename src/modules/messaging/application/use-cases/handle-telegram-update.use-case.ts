import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../../../shared/application/clock.js';
import {
  StorageNotConfiguredError,
  StorageUnavailableError,
} from '../../../../shared/application/object-storage.js';
import { describeError } from '../../../../shared/infrastructure/logging/describe-error.js';
import { SecretVault } from '../../../vault/application/secret-vault.js';
import {
  ReceiptImageTooLargeError,
  UnsupportedReceiptImageError,
} from '../../../receipts/application/errors.js';
import { IngestReceiptUseCase } from '../../../receipts/application/use-cases/receipts.use-cases.js';
import { MAX_RECEIPT_IMAGE_BYTES } from '../../../receipts/domain/receipt.js';
import { formatPhone, normalizePhoneDigits, phoneVariants } from '../../domain/phone.js';
import { CHAT_REPLIES } from '../chat-replies.js';
import { TelegramBotNotFoundError, WebhookSecretMismatchError } from '../errors.js';
import {
  type ReplyKeyboard,
  TelegramApi,
  TelegramFileTooLargeError,
} from '../ports/telegram-api.js';
import {
  type ChatSender,
  TelegramBotRepository,
  type WebhookBot,
} from '../ports/telegram-bot.repository.js';
import { TelegramWebhooks } from '../webhooks.js';

/** The parts of a Telegram update the bot acts on. */
export interface TelegramUpdate {
  message?: TelegramMessage | undefined;
}

export interface TelegramMessage {
  messageId: number;
  chat: { id: number; type: string };
  from?: { id: number; isBot: boolean; firstName: string } | undefined;
  text?: string | undefined;
  contact?: { phoneNumber: string; userId?: number | undefined } | undefined;
  /** Every size Telegram made of the photo, smallest first. */
  photo?: { fileId: string; fileSize?: number | undefined }[] | undefined;
  document?:
    { fileId: string; mimeType?: string | undefined; fileSize?: number | undefined } | undefined;
}

const SHARE_CONTACT: ReplyKeyboard = {
  kind: 'share_contact',
  label: CHAT_REPLIES.shareContactButton,
};
const NO_KEYBOARD: ReplyKeyboard = { kind: 'remove' };

/**
 * Handles one update Telegram delivered to a bot's webhook: links people who
 * share their number, and turns photos from authorized people into receipts.
 * Problems are answered in the chat, so Telegram never needs to retry.
 */
@Injectable()
export class HandleTelegramUpdateUseCase {
  private readonly logger = new Logger(HandleTelegramUpdateUseCase.name);

  constructor(
    private readonly bots: TelegramBotRepository,
    private readonly telegram: TelegramApi,
    private readonly vault: SecretVault,
    private readonly webhooks: TelegramWebhooks,
    private readonly ingest: IngestReceiptUseCase,
    private readonly clock: Clock,
  ) {}

  /** @throws TelegramBotNotFoundError, WebhookSecretMismatchError */
  async execute(botId: string, secret: string | undefined, update: TelegramUpdate): Promise<void> {
    const bot = await this.bots.findForWebhook(botId);
    if (!bot) {
      throw new TelegramBotNotFoundError();
    }
    if (!secret || !this.webhooks.matches(secret, bot.webhookSecretHash)) {
      throw new WebhookSecretMismatchError();
    }
    const message = update.message;
    // Private chats with people only: groups and other bots are not senders.
    if (
      bot.status !== 'active' ||
      !message?.from ||
      message.from.isBot ||
      message.chat.type !== 'private'
    ) {
      return;
    }

    const secretValue = await this.vault.reveal(bot.accountId, bot.tokenSecretId);
    const token = secretValue.toString('utf8');
    secretValue.fill(0);
    const reply = (text: string, keyboard?: ReplyKeyboard) =>
      this.telegram.sendMessage(token, message.chat.id, text, keyboard);

    try {
      await this.handle(bot, message, message.from.id, token, reply);
    } catch (error) {
      this.logger.error(`Telegram update for bot ${bot.id} failed`, describeError(error));
      await reply(CHAT_REPLIES.failed).catch(() => undefined);
    }
  }

  private async handle(
    bot: WebhookBot,
    message: TelegramMessage,
    userId: number,
    token: string,
    reply: (text: string, keyboard?: ReplyKeyboard) => Promise<void>,
  ): Promise<void> {
    if (message.contact) {
      await this.link(bot, message.contact, userId, reply);
      return;
    }
    const sender = await this.bots.findSenderByUser(bot.id, userId);
    if (!sender) {
      await reply(CHAT_REPLIES.askContact, SHARE_CONTACT);
      return;
    }

    const fileId = imageFileOf(message);
    if (fileId) {
      await this.receive(bot, message, sender, fileId, token, reply);
    } else if (message.document) {
      await reply(CHAT_REPLIES.onlyPhotos);
    } else {
      await reply(CHAT_REPLIES.help);
    }
  }

  private async link(
    bot: WebhookBot,
    contact: NonNullable<TelegramMessage['contact']>,
    userId: number,
    reply: (text: string, keyboard?: ReplyKeyboard) => Promise<void>,
  ): Promise<void> {
    // A forwarded contact card names someone else; only the person's own proves the number.
    if (contact.userId !== userId) {
      await reply(CHAT_REPLIES.notOwnContact, SHARE_CONTACT);
      return;
    }
    const phone = normalizePhoneDigits(contact.phoneNumber);
    const sender = phone
      ? await this.bots.linkSender(bot.id, phoneVariants(phone), userId, this.clock.now())
      : null;
    if (!sender) {
      await reply(
        CHAT_REPLIES.notAuthorizedTelegram(phone ? formatPhone(phone) : contact.phoneNumber),
        NO_KEYBOARD,
      );
      return;
    }
    await reply(CHAT_REPLIES.linked(sender.label), NO_KEYBOARD);
  }

  private async receive(
    bot: WebhookBot,
    message: TelegramMessage,
    sender: ChatSender,
    fileId: string,
    token: string,
    reply: (text: string) => Promise<void>,
  ): Promise<void> {
    const sourceMessageId = `${bot.botUserId}:${message.chat.id}:${message.messageId}`;
    if (await this.ingest.received(bot.accountId, 'telegram', sourceMessageId)) {
      return;
    }
    try {
      const image = await this.telegram.downloadFile(token, fileId, MAX_RECEIPT_IMAGE_BYTES);
      const { receipt, duplicate } = await this.ingest.execute({
        accountId: bot.accountId,
        source: 'telegram',
        sourceMessageId,
        image,
        fiscalProfileId: sender.defaultFiscalProfileId,
        senderPhone: sender.phone,
        senderLabel: sender.label,
      });
      if (!duplicate) {
        await reply(CHAT_REPLIES.received(receipt.receiver));
      }
    } catch (error) {
      if (
        error instanceof TelegramFileTooLargeError ||
        error instanceof ReceiptImageTooLargeError
      ) {
        await reply(CHAT_REPLIES.tooLarge('Telegram'));
      } else if (error instanceof UnsupportedReceiptImageError) {
        await reply(CHAT_REPLIES.onlyPhotos);
      } else if (
        error instanceof StorageNotConfiguredError ||
        error instanceof StorageUnavailableError
      ) {
        this.logger.error(`Could not store a receipt photo: ${error.message}`);
        await reply(CHAT_REPLIES.failed);
      } else {
        throw error;
      }
    }
  }
}

/** The largest size of a photo, or a document that says it is an image. */
function imageFileOf(message: TelegramMessage): string | null {
  const largest = message.photo?.at(-1);
  if (largest) {
    return largest.fileId;
  }
  return message.document?.mimeType?.startsWith('image/') ? message.document.fileId : null;
}
