import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { ReceiptsModule } from '../receipts/receipts.module.js';
import { VaultModule } from '../vault/vault.module.js';
import { WhatsAppChannelRepository } from './application/ports/whatsapp-channel.repository.js';
import { HandleTelegramUpdateUseCase } from './application/use-cases/handle-telegram-update.use-case.js';
import { ConnectWhatsAppChannelUseCase } from './application/use-cases/connect-whatsapp-channel.use-case.js';
import { DisconnectWhatsAppChannelUseCase } from './application/use-cases/disconnect-whatsapp-channel.use-case.js';
import { ListWhatsAppChannelsUseCase } from './application/use-cases/list-whatsapp-channels.use-case.js';
import {
  AddSenderUseCase,
  RemoveSenderUseCase,
  UpdateSenderUseCase,
} from './application/use-cases/manage-senders.use-cases.js';
import { RotateVerifyTokenUseCase } from './application/use-cases/rotate-verify-token.use-case.js';
import { VerifyWebhookUseCase } from './application/use-cases/verify-webhook.use-case.js';
import { TelegramApi } from './application/ports/telegram-api.js';
import { TelegramBotRepository } from './application/ports/telegram-bot.repository.js';
import {
  AddTelegramSenderUseCase,
  ConnectTelegramBotUseCase,
  DisconnectTelegramBotUseCase,
  ListTelegramBotsUseCase,
  RemoveTelegramSenderUseCase,
  UpdateTelegramSenderUseCase,
} from './application/use-cases/telegram-bots.use-cases.js';
import { TelegramWebhooks, WebhookSettings, WebhookVerification } from './application/webhooks.js';
import { DrizzleTelegramBotRepository } from './infrastructure/drizzle-telegram-bot.repository.js';
import { DrizzleWhatsAppChannelRepository } from './infrastructure/drizzle-whatsapp-channel.repository.js';
import { FetchTelegramApi, TelegramApiSettings } from './infrastructure/fetch-telegram.api.js';
import { TelegramBotsController } from './presentation/http/telegram-bots.controller.js';
import { TelegramWebhookController } from './presentation/http/telegram-webhook.controller.js';
import { WhatsAppChannelsController } from './presentation/http/whatsapp-channels.controller.js';
import { WhatsAppWebhookController } from './presentation/http/whatsapp-webhook.controller.js';

/**
 * The chat channels receipts arrive through: WhatsApp numbers and Telegram bots
 * customers connect, their authorized senders and the providers' webhooks.
 */
@Module({
  imports: [VaultModule, ReceiptsModule],
  controllers: [
    WhatsAppChannelsController,
    WhatsAppWebhookController,
    TelegramBotsController,
    TelegramWebhookController,
  ],
  providers: [
    { provide: WhatsAppChannelRepository, useClass: DrizzleWhatsAppChannelRepository },
    { provide: TelegramBotRepository, useClass: DrizzleTelegramBotRepository },
    {
      provide: TelegramApiSettings,
      inject: [AppConfig],
      useFactory: (config: AppConfig): TelegramApiSettings => ({
        baseUrl: config.messaging.telegramApiUrl,
      }),
    },
    { provide: TelegramApi, useClass: FetchTelegramApi },
    TelegramWebhooks,
    {
      provide: WebhookSettings,
      inject: [AppConfig],
      useFactory: (config: AppConfig): WebhookSettings => ({
        apiPublicUrl: config.http.apiPublicUrl,
      }),
    },
    WebhookVerification,
    ListWhatsAppChannelsUseCase,
    ConnectWhatsAppChannelUseCase,
    DisconnectWhatsAppChannelUseCase,
    RotateVerifyTokenUseCase,
    VerifyWebhookUseCase,
    AddSenderUseCase,
    UpdateSenderUseCase,
    RemoveSenderUseCase,
    ListTelegramBotsUseCase,
    ConnectTelegramBotUseCase,
    DisconnectTelegramBotUseCase,
    AddTelegramSenderUseCase,
    UpdateTelegramSenderUseCase,
    RemoveTelegramSenderUseCase,
    HandleTelegramUpdateUseCase,
  ],
})
export class MessagingModule {}
