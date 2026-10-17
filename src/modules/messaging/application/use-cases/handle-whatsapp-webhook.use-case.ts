import { Injectable, Logger } from '@nestjs/common';
import {
  StorageNotConfiguredError,
  StorageUnavailableError,
} from '../../../../shared/application/object-storage.js';
import { describeError } from '../../../../shared/infrastructure/logging/describe-error.js';
import {
  ReceiptImageTooLargeError,
  UnsupportedReceiptImageError,
} from '../../../receipts/application/errors.js';
import { IngestReceiptUseCase } from '../../../receipts/application/use-cases/receipts.use-cases.js';
import { MAX_RECEIPT_IMAGE_BYTES } from '../../../receipts/domain/receipt.js';
import { SecretVault } from '../../../vault/application/secret-vault.js';
import { dialablePhone, phoneVariants } from '../../domain/phone.js';
import { CHAT_REPLIES } from '../chat-replies.js';
import { WebhookSignatureMismatchError, WhatsAppChannelNotFoundError } from '../errors.js';
import {
  WhatsAppCloudApi,
  WhatsAppMediaTooLargeError,
  WhatsAppTokenRejectedError,
} from '../ports/whatsapp-cloud-api.js';
import {
  type WebhookChannel,
  WhatsAppChannelRepository,
} from '../ports/whatsapp-channel.repository.js';
import { metaSignatureMatches } from '../webhooks.js';

/** One incoming message, as the controller reads it from Meta's payload. */
export interface WhatsAppInboundMessage {
  /** wamid: unique per message, the idempotency key. */
  id: string;
  /** The sender's wa_id (country code and number). */
  from: string;
  type: string;
  image?: { id: string } | undefined;
  document?: { id: string; mimeType?: string | undefined } | undefined;
}

/** Messages Meta delivered for one business number. */
export interface WhatsAppInboundBatch {
  phoneNumberId: string;
  messages: WhatsAppInboundMessage[];
}

interface Conversation {
  channel: WebhookChannel & { accountId: string };
  token: string;
  message: WhatsAppInboundMessage;
}

/**
 * Handles a signed POST from Meta: photos from authorized phones become
 * receipts; everyone else gets an answer in the chat. Meta retries anything
 * that is not a 2xx for days, so problems are answered, not thrown.
 */
@Injectable()
export class HandleWhatsAppWebhookUseCase {
  private readonly logger = new Logger(HandleWhatsAppWebhookUseCase.name);

  constructor(
    private readonly channels: WhatsAppChannelRepository,
    private readonly whatsapp: WhatsAppCloudApi,
    private readonly vault: SecretVault,
    private readonly ingest: IngestReceiptUseCase,
  ) {}

  /** @throws WhatsAppChannelNotFoundError, WebhookSignatureMismatchError */
  async execute(
    channelId: string,
    signature: string | undefined,
    rawBody: Buffer | undefined,
    batches: WhatsAppInboundBatch[],
  ): Promise<void> {
    const channel = await this.channels.findForWebhook(channelId);
    if (!channel?.accountId || !channel.appSecretSecretId || !channel.accessTokenSecretId) {
      throw new WhatsAppChannelNotFoundError();
    }
    const accountId = channel.accountId;
    const appSecret = await this.reveal(accountId, channel.appSecretSecretId);
    if (!rawBody || !metaSignatureMatches(appSecret, rawBody, signature)) {
      throw new WebhookSignatureMismatchError();
    }
    if (channel.status === 'disabled') {
      return;
    }

    const messages = batches
      .filter((batch) => batch.phoneNumberId === channel.phoneNumberId)
      .flatMap((batch) => batch.messages);
    if (messages.length === 0) {
      return; // Delivery statuses and other numbers' events.
    }
    const token = await this.reveal(accountId, channel.accessTokenSecretId);
    for (const message of messages) {
      await this.handle({ channel: { ...channel, accountId }, token, message });
    }
  }

  private async handle(conversation: Conversation): Promise<void> {
    const { channel, message } = conversation;
    try {
      const sender = await this.channels.findSender(channel.id, phoneVariants(message.from));
      if (!sender) {
        await this.reply(conversation, CHAT_REPLIES.notAuthorizedWhatsApp);
        return;
      }
      const mediaId = imageOf(message);
      if (mediaId) {
        await this.receive(conversation, mediaId, sender);
      } else if (message.type === 'document') {
        await this.reply(conversation, CHAT_REPLIES.onlyPhotos);
      } else {
        await this.reply(conversation, CHAT_REPLIES.help);
      }
    } catch (error) {
      this.logger.error(`WhatsApp message on channel ${channel.id} failed`, describeError(error));
      if (!(error instanceof WhatsAppTokenRejectedError)) {
        await this.reply(conversation, CHAT_REPLIES.failed).catch(() => undefined);
      }
    }
  }

  private async receive(
    conversation: Conversation,
    mediaId: string,
    sender: { waId: string; label: string | null; defaultFiscalProfileId: string | null },
  ): Promise<void> {
    const { channel, token, message } = conversation;
    if (await this.ingest.received(channel.accountId, 'whatsapp', message.id)) {
      return;
    }
    try {
      const image = await this.whatsapp.downloadMedia(token, mediaId, MAX_RECEIPT_IMAGE_BYTES);
      const { receipt, duplicate } = await this.ingest.execute({
        accountId: channel.accountId,
        source: 'whatsapp',
        sourceMessageId: message.id,
        image,
        fiscalProfileId: sender.defaultFiscalProfileId,
        senderPhone: sender.waId,
        senderLabel: sender.label,
      });
      if (!duplicate) {
        await this.reply(conversation, CHAT_REPLIES.received(receipt.receiver));
      }
    } catch (error) {
      if (
        error instanceof WhatsAppMediaTooLargeError ||
        error instanceof ReceiptImageTooLargeError
      ) {
        await this.reply(conversation, CHAT_REPLIES.tooLarge('WhatsApp'));
      } else if (error instanceof UnsupportedReceiptImageError) {
        await this.reply(conversation, CHAT_REPLIES.onlyPhotos);
      } else if (
        error instanceof StorageNotConfiguredError ||
        error instanceof StorageUnavailableError
      ) {
        this.logger.error(`Could not store a receipt photo: ${error.message}`);
        await this.reply(conversation, CHAT_REPLIES.failed);
      } else {
        throw error;
      }
    }
  }

  private reply({ channel, token, message }: Conversation, text: string): Promise<void> {
    return this.whatsapp.sendText(token, channel.phoneNumberId, dialablePhone(message.from), text);
  }

  private async reveal(accountId: string, secretId: string): Promise<string> {
    const secret = await this.vault.reveal(accountId, secretId);
    const value = secret.toString('utf8');
    secret.fill(0);
    return value;
  }
}

/** The media id of a photo, or of a document that says it is an image. */
function imageOf(message: WhatsAppInboundMessage): string | null {
  if (message.type === 'image' && message.image) {
    return message.image.id;
  }
  if (message.type === 'document' && message.document?.mimeType?.startsWith('image/')) {
    return message.document.id;
  }
  return null;
}
