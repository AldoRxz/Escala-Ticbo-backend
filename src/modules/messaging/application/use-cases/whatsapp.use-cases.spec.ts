import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidInputError } from '../../../../shared/domain/app-error.js';
import { InsufficientRoleError } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import {
  WebhookVerificationFailedError,
  WhatsAppChannelNotFoundError,
  WhatsAppNumberAlreadyConnectedError,
  WhatsAppSenderAlreadyAuthorizedError,
} from '../errors.js';
import { FakeSecretVault, InMemoryWhatsAppChannelRepository } from '../testing/fakes.js';
import { WebhookVerification } from '../webhooks.js';
import { ConnectWhatsAppChannelUseCase } from './connect-whatsapp-channel.use-case.js';
import { DisconnectWhatsAppChannelUseCase } from './disconnect-whatsapp-channel.use-case.js';
import { AddSenderUseCase, RemoveSenderUseCase } from './manage-senders.use-cases.js';
import { RotateVerifyTokenUseCase } from './rotate-verify-token.use-case.js';
import { VerifyWebhookUseCase } from './verify-webhook.use-case.js';

const owner: Principal = { userId: 'u1', sessionId: 's1', accountId: 'acc-1', role: 'owner' };
const member: Principal = { ...owner, userId: 'u2', role: 'member' };
const otherAccount: Principal = { ...owner, userId: 'u3', accountId: 'acc-2' };

const credentials = {
  phoneNumberId: '106540352242922',
  businessAccountId: '102290129340398',
  displayPhoneNumber: '5512345678',
  accessToken: 'EAAGm0PX4ZCpsBAKZB1234567890abcdefghij',
  appSecret: '0123456789abcdef0123456789abcdef',
};

describe('WhatsApp use cases', () => {
  let channels: InMemoryWhatsAppChannelRepository;
  let vault: FakeSecretVault;
  let webhooks: WebhookVerification;
  let connect: ConnectWhatsAppChannelUseCase;

  beforeEach(() => {
    channels = new InMemoryWhatsAppChannelRepository();
    vault = new FakeSecretVault();
    webhooks = new WebhookVerification({ apiPublicUrl: 'https://api.ticbo.com' });
    connect = new ConnectWhatsAppChannelUseCase(channels, vault.asVault(), webhooks);
  });

  it('connects a number with its credentials in the vault and a one-time verify token', async () => {
    const { channel, verifyToken } = await connect.execute(owner, credentials);

    expect(channel).toMatchObject({
      displayPhoneNumber: '+525512345678',
      status: 'pending_verification',
    });
    expect([...vault.secrets.values()].map((s) => [s.kind, s.value])).toEqual([
      ['whatsapp_access_token', credentials.accessToken],
      ['whatsapp_app_secret', credentials.appSecret],
    ]);
    expect(verifyToken.length).toBeGreaterThanOrEqual(32);
    expect(channels.channels[0]?.verifyTokenHash).not.toContain(verifyToken);
    expect(webhooks.urlFor(channel.id)).toBe(
      `https://api.ticbo.com/api/v1/webhooks/whatsapp/${channel.id}`,
    );
  });

  it('does not keep credentials when the number cannot be saved', async () => {
    await connect.execute(owner, credentials);

    await expect(connect.execute(otherAccount, credentials)).rejects.toThrow(
      WhatsAppNumberAlreadyConnectedError,
    );
    expect(vault.secrets.size).toBe(2);
  });

  it('only lets owners and admins connect, with valid credentials', async () => {
    await expect(connect.execute(member, credentials)).rejects.toThrow(InsufficientRoleError);
    await expect(connect.execute(owner, { ...credentials, appSecret: 'x' })).rejects.toThrow(
      InvalidInputError,
    );
    expect(vault.secrets.size).toBe(0);
  });

  it('verifies the webhook with the right token only, and activates the channel', async () => {
    const { channel, verifyToken } = await connect.execute(owner, credentials);
    const verify = new VerifyWebhookUseCase(channels, webhooks);
    const request = { mode: 'subscribe', token: verifyToken, challenge: '1158201444' };

    await expect(verify.execute(channel.id, { ...request, token: 'wrong' })).rejects.toThrow(
      WebhookVerificationFailedError,
    );
    await expect(verify.execute(channel.id, { ...request, mode: 'unsubscribe' })).rejects.toThrow(
      WebhookVerificationFailedError,
    );
    await expect(verify.execute(channel.id, request)).resolves.toBe('1158201444');
    expect((await channels.find('acc-1', channel.id))?.status).toBe('active');
  });

  it('replaces the verify token', async () => {
    const { channel, verifyToken } = await connect.execute(owner, credentials);
    const fresh = await new RotateVerifyTokenUseCase(channels, webhooks).execute(owner, channel.id);
    const verify = new VerifyWebhookUseCase(channels, webhooks);

    await expect(
      verify.execute(channel.id, { mode: 'subscribe', token: verifyToken, challenge: '1' }),
    ).rejects.toThrow(WebhookVerificationFailedError);
    await expect(
      verify.execute(channel.id, { mode: 'subscribe', token: fresh, challenge: '1' }),
    ).resolves.toBe('1');
  });

  it('disconnects a number and deletes its credentials', async () => {
    const { channel } = await connect.execute(owner, credentials);
    const disconnect = new DisconnectWhatsAppChannelUseCase(channels, vault.asVault());

    await expect(disconnect.execute(otherAccount, channel.id)).rejects.toThrow(
      WhatsAppChannelNotFoundError,
    );
    await disconnect.execute(owner, channel.id);
    expect(channels.channels).toHaveLength(0);
    expect(vault.secrets.size).toBe(0);
  });

  it('authorizes phones once per number, only on numbers of the account', async () => {
    const { channel } = await connect.execute(owner, credentials);
    const add = new AddSenderUseCase(channels);

    const sender = await add.execute(owner, channel.id, { waId: '55 8765 4321', label: ' Juan ' });
    expect(sender).toMatchObject({ waId: '525587654321', label: 'Juan' });

    await expect(add.execute(owner, channel.id, { waId: '5587654321' })).rejects.toThrow(
      WhatsAppSenderAlreadyAuthorizedError,
    );
    await expect(add.execute(owner, channel.id, { waId: '123' })).rejects.toThrow(
      InvalidInputError,
    );
    await expect(add.execute(otherAccount, channel.id, { waId: '5511112222' })).rejects.toThrow(
      WhatsAppChannelNotFoundError,
    );
    await expect(add.execute(member, channel.id, { waId: '5511112222' })).rejects.toThrow(
      InsufficientRoleError,
    );

    await new RemoveSenderUseCase(channels).execute(owner, channel.id, sender.id);
    expect(channels.senders).toHaveLength(0);
  });
});
