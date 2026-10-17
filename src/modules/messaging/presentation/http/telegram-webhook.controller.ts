import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../../shared/infrastructure/http/zod-validation.pipe.js';
import { Public } from '../../../iam/presentation/http/auth.decorators.js';
import {
  HandleTelegramUpdateUseCase,
  type TelegramUpdate,
} from '../../application/use-cases/handle-telegram-update.use-case.js';
import { idSchema } from './whatsapp.schemas.js';

const telegramId = z.number().int();
const fileId = z.string().min(1).max(256);

// Only what the bot reads; Telegram sends many more fields and those are ignored.
const updateSchema = z
  .object({
    message: z
      .object({
        message_id: telegramId,
        chat: z.object({ id: telegramId, type: z.string().max(32) }),
        from: z
          .object({ id: telegramId, is_bot: z.boolean(), first_name: z.string().max(256) })
          .optional(),
        text: z.string().max(4096).optional(),
        contact: z
          .object({ phone_number: z.string().max(32), user_id: telegramId.optional() })
          .optional(),
        photo: z
          .array(z.object({ file_id: fileId, file_size: z.number().int().optional() }))
          .max(20)
          .optional(),
        document: z
          .object({
            file_id: fileId,
            mime_type: z.string().max(128).optional(),
            file_size: z.number().int().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .transform(({ message }): TelegramUpdate => ({
    message: message && {
      messageId: message.message_id,
      chat: message.chat,
      from: message.from && {
        id: message.from.id,
        isBot: message.from.is_bot,
        firstName: message.from.first_name,
      },
      text: message.text,
      contact: message.contact && {
        phoneNumber: message.contact.phone_number,
        userId: message.contact.user_id,
      },
      photo: message.photo?.map((size) => ({ fileId: size.file_id, fileSize: size.file_size })),
      document: message.document && {
        fileId: message.document.file_id,
        mimeType: message.document.mime_type,
        fileSize: message.document.file_size,
      },
    },
  }))
  // An update this bot cannot read is skipped, not refused: a refusal makes
  // Telegram retry it again and again.
  .catch({});

/**
 * Telegram delivers each bot's updates here, with the secret Ticbo registered
 * in X-Telegram-Bot-Api-Secret-Token instead of a bearer token.
 */
@Public()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(private readonly handleUpdate: HandleTelegramUpdateUseCase) {}

  @Post(':botId')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('botId', new ZodValidationPipe(idSchema)) botId: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body(new ZodValidationPipe(updateSchema)) update: TelegramUpdate,
  ): Promise<{ ok: true }> {
    await this.handleUpdate.execute(botId, secret, update);
    return { ok: true };
  }
}
