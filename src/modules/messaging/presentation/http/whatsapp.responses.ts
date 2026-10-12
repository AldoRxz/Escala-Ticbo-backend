import type {
  WhatsAppChannel,
  WhatsAppChannelStatus,
  WhatsAppSender,
} from '../../domain/whatsapp.js';

export interface SenderResponse {
  id: string;
  waId: string;
  label: string | null;
  defaultFiscalProfileId: string | null;
  createdAt: string;
}

/** A connected number. Credentials are never returned; only where to register the webhook. */
export interface ChannelResponse {
  id: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  status: WhatsAppChannelStatus;
  webhookUrl: string;
  createdAt: string;
  senders: SenderResponse[];
}

export function toSenderResponse(sender: WhatsAppSender): SenderResponse {
  return {
    id: sender.id,
    waId: sender.waId,
    label: sender.label,
    defaultFiscalProfileId: sender.defaultFiscalProfileId,
    createdAt: sender.createdAt.toISOString(),
  };
}

export function toChannelResponse(channel: WhatsAppChannel, webhookUrl: string): ChannelResponse {
  return {
    id: channel.id,
    phoneNumberId: channel.phoneNumberId,
    businessAccountId: channel.businessAccountId,
    displayPhoneNumber: channel.displayPhoneNumber,
    status: channel.status,
    webhookUrl,
    createdAt: channel.createdAt.toISOString(),
    senders: channel.senders.map(toSenderResponse),
  };
}
