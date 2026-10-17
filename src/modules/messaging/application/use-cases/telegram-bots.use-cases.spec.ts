import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidInputError } from '../../../../shared/domain/app-error.js';
import { InsufficientRoleError } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import {
  TelegramBotAlreadyConnectedError,
  TelegramBotNotFoundError,
  TelegramSenderAlreadyAuthorizedError,
  TelegramUnavailableError,
} from '../errors.js';
import { FakeSecretVault } from '../testing/fakes.js';
import { FakeTelegramApi, InMemoryTelegramBotRepository } from '../testing/telegram-fakes.js';
import { TelegramWebhooks } from '../webhooks.js';
import {
  AddTelegramSenderUseCase,
  ConnectTelegramBotUseCase,
  DisconnectTelegramBotUseCase,
  ListTelegramBotsUseCase,
  RemoveTelegramSenderUseCase,
  UpdateTelegramSenderUseCase,
} from './telegram-bots.use-cases.js';

const owner: Principal = { userId: 'u1', sessionId: 's1', accountId: 'acc-1', role: 'owner' };
const member: Principal = { ...owner, userId: 'u2', role: 'member' };
const otherAccount: Principal = { ...owner, userId: 'u3', accountId: 'acc-2' };

const TOKEN = '7012345678:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

describe('Telegram bot use cases', () => {
  let bots: InMemoryTelegramBotRepository;
  let telegram: FakeTelegramApi;
  let vault: FakeSecretVault;
  let webhooks: TelegramWebhooks;
  let connect: ConnectTelegramBotUseCase;

  beforeEach(() => {
    bots = new InMemoryTelegramBotRepository();
    telegram = new FakeTelegramApi();
    telegram.profiles.set(TOKEN, {
      id: 7012345678,
      username: 'AndinaFacturasBot',
      displayName: 'Andina Facturas',
    });
    vault = new FakeSecretVault();
    webhooks = new TelegramWebhooks({ apiPublicUrl: 'https://api.ticbo.com' });
    connect = new ConnectTelegramBotUseCase(bots, telegram, vault.asVault(), webhooks);
  });

  it('connects a bot: token in the vault and the webhook registered with a secret', async () => {
    const bot = await connect.execute(owner, { token: `  ${TOKEN} ` });

    expect(bot).toMatchObject({
      botUserId: 7012345678,
      username: 'AndinaFacturasBot',
      displayName: 'Andina Facturas',
      status: 'active',
      senders: [],
    });
    expect([...vault.secrets.values()]).toEqual([
      { accountId: 'acc-1', kind: 'telegram_bot_token', value: TOKEN },
    ]);
    const webhook = telegram.webhooks.get(TOKEN)!;
    expect(webhook.url).toBe(`https://api.ticbo.com/api/v1/webhooks/telegram/${bot.id}`);
    expect(webhook.secretToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(webhooks.matches(webhook.secretToken, bots.bots[0]!.webhookSecretHash)).toBe(true);
    expect(bots.bots[0]!.webhookSecretHash).not.toContain(webhook.secretToken);
  });

  it('rejects what is not a bot token and tokens Telegram does not know', async () => {
    await expect(connect.execute(owner, { token: 'not-a-token' })).rejects.toMatchObject({
      issues: [{ path: 'token', code: 'invalid_bot_token' }],
    });
    await expect(
      connect.execute(owner, { token: '7012345678:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDzzz' }),
    ).rejects.toMatchObject({ issues: [{ path: 'token', code: 'bot_token_rejected' }] });
    expect(vault.secrets.size).toBe(0);
  });

  it('does not take over a bot another account already connected', async () => {
    await connect.execute(owner, { token: TOKEN });
    telegram.webhooks.clear();

    await expect(connect.execute(otherAccount, { token: TOKEN })).rejects.toBeInstanceOf(
      TelegramBotAlreadyConnectedError,
    );
    expect(telegram.webhooks.size).toBe(0);
    expect(vault.secrets.size).toBe(1);
  });

  it('leaves nothing behind when Telegram is down', async () => {
    telegram.down = true;
    await expect(connect.execute(owner, { token: TOKEN })).rejects.toBeInstanceOf(
      TelegramUnavailableError,
    );

    telegram.down = false;
    telegram.setWebhook = () => Promise.reject(new TelegramUnavailableError());
    await expect(connect.execute(owner, { token: TOKEN })).rejects.toBeInstanceOf(
      TelegramUnavailableError,
    );
    expect(bots.bots).toEqual([]);
    expect(vault.secrets.size).toBe(0);
  });

  it('only lets owners and admins connect and disconnect bots', async () => {
    await expect(connect.execute(member, { token: TOKEN })).rejects.toBeInstanceOf(
      InsufficientRoleError,
    );
    const bot = await connect.execute(owner, { token: TOKEN });
    const disconnect = new DisconnectTelegramBotUseCase(bots, telegram, vault.asVault());
    await expect(disconnect.execute(member, bot.id)).rejects.toBeInstanceOf(InsufficientRoleError);
    expect(await new ListTelegramBotsUseCase(bots).execute(member)).toHaveLength(1);
  });

  it('disconnects a bot: webhook removed, token deleted, other accounts cannot', async () => {
    const bot = await connect.execute(owner, { token: TOKEN });
    const disconnect = new DisconnectTelegramBotUseCase(bots, telegram, vault.asVault());

    await expect(disconnect.execute(otherAccount, bot.id)).rejects.toBeInstanceOf(
      TelegramBotNotFoundError,
    );
    await disconnect.execute(owner, bot.id);

    expect(bots.bots).toEqual([]);
    expect(telegram.webhooks.size).toBe(0);
    expect(vault.secrets.size).toBe(0);
  });

  it('authorizes phones once per bot, normalized to digits with the country code', async () => {
    const bot = await connect.execute(owner, { token: TOKEN });
    const add = new AddTelegramSenderUseCase(bots);

    const sender = await add.execute(owner, bot.id, { phone: '(55) 1234-5678', label: ' Juan ' });
    expect(sender).toMatchObject({ phone: '525512345678', label: 'Juan', linkedAt: null });

    await expect(add.execute(owner, bot.id, { phone: '5512345678' })).rejects.toBeInstanceOf(
      TelegramSenderAlreadyAuthorizedError,
    );
    await expect(add.execute(owner, bot.id, { phone: '123' })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    await expect(add.execute(otherAccount, bot.id, { phone: '5598765432' })).rejects.toBeInstanceOf(
      TelegramBotNotFoundError,
    );

    const updated = await new UpdateTelegramSenderUseCase(bots).execute(owner, bot.id, sender.id, {
      label: 'Juan · ventas',
    });
    expect(updated.label).toBe('Juan · ventas');

    await new RemoveTelegramSenderUseCase(bots).execute(owner, bot.id, sender.id);
    expect(bots.senders).toEqual([]);
  });
});
