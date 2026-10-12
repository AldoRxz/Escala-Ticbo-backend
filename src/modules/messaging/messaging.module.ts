import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { VaultModule } from '../vault/vault.module.js';
import { WhatsAppChannelRepository } from './application/ports/whatsapp-channel.repository.js';
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
import { WebhookSettings, WebhookVerification } from './application/webhook-verification.js';
import { DrizzleWhatsAppChannelRepository } from './infrastructure/drizzle-whatsapp-channel.repository.js';
import { WhatsAppChannelsController } from './presentation/http/whatsapp-channels.controller.js';
import { WhatsAppWebhookController } from './presentation/http/whatsapp-webhook.controller.js';

/** WhatsApp numbers customers connect, their authorized senders and Meta's webhook. */
@Module({
  imports: [VaultModule],
  controllers: [WhatsAppChannelsController, WhatsAppWebhookController],
  providers: [
    { provide: WhatsAppChannelRepository, useClass: DrizzleWhatsAppChannelRepository },
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
  ],
})
export class MessagingModule {}
