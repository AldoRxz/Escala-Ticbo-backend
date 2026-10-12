import type { SecretKind } from '../../../vault/domain/secret.js';
import type { SecretVault } from '../../../vault/application/secret-vault.js';
import type { WhatsAppChannel, WhatsAppSender } from '../../domain/whatsapp.js';
import {
  WhatsAppNumberAlreadyConnectedError,
  WhatsAppSenderAlreadyAuthorizedError,
} from '../errors.js';
import type {
  NewChannel,
  NewSender,
  RemovedChannel,
  SenderChanges,
  WebhookChannel,
  WhatsAppChannelRepository,
} from '../ports/whatsapp-channel.repository.js';

type StoredChannel = Omit<WhatsAppChannel, 'senders'> & NewChannel;

export class InMemoryWhatsAppChannelRepository implements WhatsAppChannelRepository {
  readonly channels: StoredChannel[] = [];
  readonly senders: (WhatsAppSender & { accountId: string })[] = [];
  failNextInsert: Error | null = null;

  private view(channel: StoredChannel): WhatsAppChannel {
    return {
      id: channel.id,
      accountId: channel.accountId,
      phoneNumberId: channel.phoneNumberId,
      businessAccountId: channel.businessAccountId,
      displayPhoneNumber: channel.displayPhoneNumber,
      status: channel.status,
      createdAt: channel.createdAt,
      senders: this.senders.filter((sender) => sender.channelId === channel.id),
    };
  }

  list(accountId: string): Promise<WhatsAppChannel[]> {
    return Promise.resolve(
      this.channels.filter((c) => c.accountId === accountId).map((c) => this.view(c)),
    );
  }

  find(accountId: string, id: string): Promise<WhatsAppChannel | null> {
    const channel = this.channels.find((c) => c.accountId === accountId && c.id === id);
    return Promise.resolve(channel ? this.view(channel) : null);
  }

  insert(channel: NewChannel): Promise<WhatsAppChannel> {
    if (this.failNextInsert) {
      const error = this.failNextInsert;
      this.failNextInsert = null;
      return Promise.reject(error);
    }
    if (this.channels.some((c) => c.phoneNumberId === channel.phoneNumberId)) {
      return Promise.reject(new WhatsAppNumberAlreadyConnectedError());
    }
    const stored: StoredChannel = {
      ...channel,
      status: 'pending_verification',
      createdAt: new Date(),
    };
    this.channels.push(stored);
    return Promise.resolve(this.view(stored));
  }

  delete(accountId: string, id: string): Promise<RemovedChannel | null> {
    const index = this.channels.findIndex((c) => c.accountId === accountId && c.id === id);
    if (index < 0) {
      return Promise.resolve(null);
    }
    const [channel] = this.channels.splice(index, 1);
    return Promise.resolve({
      accessTokenSecretId: channel!.accessTokenSecretId,
      appSecretSecretId: channel!.appSecretSecretId,
    });
  }

  setVerifyTokenHash(accountId: string, id: string, hash: string): Promise<boolean> {
    const channel = this.channels.find((c) => c.accountId === accountId && c.id === id);
    if (channel) {
      channel.verifyTokenHash = hash;
    }
    return Promise.resolve(Boolean(channel));
  }

  findForWebhook(id: string): Promise<WebhookChannel | null> {
    const channel = this.channels.find((c) => c.id === id);
    return Promise.resolve(
      channel
        ? {
            id: channel.id,
            accountId: channel.accountId,
            status: channel.status,
            verifyTokenHash: channel.verifyTokenHash,
          }
        : null,
    );
  }

  markActive(id: string): Promise<void> {
    const index = this.channels.findIndex((c) => c.id === id);
    if (index >= 0) {
      this.channels[index] = { ...this.channels[index]!, status: 'active' };
    }
    return Promise.resolve();
  }

  addSender(sender: NewSender): Promise<WhatsAppSender> {
    if (this.senders.some((s) => s.channelId === sender.channelId && s.waId === sender.waId)) {
      return Promise.reject(new WhatsAppSenderAlreadyAuthorizedError());
    }
    const stored = { ...sender, createdAt: new Date() };
    this.senders.push(stored);
    return Promise.resolve(stored);
  }

  updateSender(
    accountId: string,
    channelId: string,
    senderId: string,
    changes: SenderChanges,
  ): Promise<WhatsAppSender | null> {
    const sender = this.senders.find(
      (s) => s.accountId === accountId && s.channelId === channelId && s.id === senderId,
    );
    if (!sender) {
      return Promise.resolve(null);
    }
    Object.assign(sender, changes);
    return Promise.resolve(sender);
  }

  removeSender(accountId: string, channelId: string, senderId: string): Promise<boolean> {
    const index = this.senders.findIndex(
      (s) => s.accountId === accountId && s.channelId === channelId && s.id === senderId,
    );
    if (index >= 0) {
      this.senders.splice(index, 1);
    }
    return Promise.resolve(index >= 0);
  }
}

/** Keeps "secrets" in a map; enough to check what the use cases store and remove. */
export class FakeSecretVault {
  readonly secrets = new Map<string, { accountId: string; kind: SecretKind; value: string }>();
  private next = 0;

  store(accountId: string, kind: SecretKind, plaintext: string | Buffer): Promise<string> {
    const id = `secret-${++this.next}`;
    this.secrets.set(id, { accountId, kind, value: plaintext.toString() });
    return Promise.resolve(id);
  }

  remove(_accountId: string, secretId: string): Promise<void> {
    this.secrets.delete(secretId);
    return Promise.resolve();
  }

  asVault(): SecretVault {
    return this as unknown as SecretVault;
  }
}
