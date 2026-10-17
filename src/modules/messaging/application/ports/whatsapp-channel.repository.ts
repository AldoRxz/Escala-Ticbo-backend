import type {
  WhatsAppChannel,
  WhatsAppChannelStatus,
  WhatsAppSender,
} from '../../domain/whatsapp.js';
import type { SenderChanges } from './senders.js';

export interface NewChannel {
  id: string;
  accountId: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  accessTokenSecretId: string;
  appSecretSecretId: string;
  verifyTokenHash: string;
}

/** Vault references a removed channel leaves behind, for the caller to delete. */
export interface RemovedChannel {
  accessTokenSecretId: string | null;
  appSecretSecretId: string | null;
}

/** What the webhook needs before the tenant is known. */
export interface WebhookChannel {
  id: string;
  accountId: string | null;
  phoneNumberId: string;
  status: WhatsAppChannelStatus;
  verifyTokenHash: string | null;
  accessTokenSecretId: string | null;
  appSecretSecretId: string | null;
}

/** An authorized phone, as the webhook sees it. */
export interface ChatWhatsAppSender {
  id: string;
  waId: string;
  label: string | null;
  defaultFiscalProfileId: string | null;
}

export interface NewSender {
  id: string;
  accountId: string;
  channelId: string;
  waId: string;
  label: string | null;
  defaultFiscalProfileId: string | null;
}

/**
 * WhatsApp channels and their senders. These tables are routing data read
 * before a tenant is known (no row-level filter), so every account-facing
 * method takes the account and must filter by it.
 */
export abstract class WhatsAppChannelRepository {
  abstract list(accountId: string): Promise<WhatsAppChannel[]>;

  abstract find(accountId: string, id: string): Promise<WhatsAppChannel | null>;

  /** @throws WhatsAppNumberAlreadyConnectedError */
  abstract insert(channel: NewChannel): Promise<WhatsAppChannel>;

  abstract delete(accountId: string, id: string): Promise<RemovedChannel | null>;

  abstract setVerifyTokenHash(accountId: string, id: string, hash: string): Promise<boolean>;

  abstract findForWebhook(id: string): Promise<WebhookChannel | null>;

  abstract markActive(id: string): Promise<void>;

  /** The sender of the channel with any of these numbers (the forms one phone can take). */
  abstract findSender(channelId: string, waIds: string[]): Promise<ChatWhatsAppSender | null>;

  /** @throws WhatsAppSenderAlreadyAuthorizedError, UnknownFiscalProfileError */
  abstract addSender(sender: NewSender): Promise<WhatsAppSender>;

  /** Null when the sender does not exist on that channel of the account. @throws UnknownFiscalProfileError */
  abstract updateSender(
    accountId: string,
    channelId: string,
    senderId: string,
    changes: SenderChanges,
  ): Promise<WhatsAppSender | null>;

  abstract removeSender(accountId: string, channelId: string, senderId: string): Promise<boolean>;
}
