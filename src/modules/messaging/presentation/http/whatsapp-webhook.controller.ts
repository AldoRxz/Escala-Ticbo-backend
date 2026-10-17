import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../../shared/infrastructure/http/zod-validation.pipe.js';
import { Public } from '../../../iam/presentation/http/auth.decorators.js';
import {
  HandleWhatsAppWebhookUseCase,
  type WhatsAppInboundBatch,
} from '../../application/use-cases/handle-whatsapp-webhook.use-case.js';
import { VerifyWebhookUseCase } from '../../application/use-cases/verify-webhook.use-case.js';
import {
  idSchema,
  type WebhookVerificationQuery,
  webhookVerificationQuerySchema,
} from './whatsapp.schemas.js';

const metaId = z.string().min(1).max(256);

// Only what the bot reads from Meta's notification; the rest is ignored.
const notificationSchema = z
  .object({
    entry: z
      .array(
        z.object({
          changes: z
            .array(
              z.object({
                field: z.string().max(64).optional(),
                value: z
                  .object({
                    metadata: z.object({ phone_number_id: metaId }).optional(),
                    messages: z
                      .array(
                        z.object({
                          id: metaId,
                          from: z.string().max(32),
                          type: z.string().max(32),
                          image: z.object({ id: metaId }).optional(),
                          document: z
                            .object({ id: metaId, mime_type: z.string().max(128).optional() })
                            .optional(),
                        }),
                      )
                      .max(100)
                      .optional(),
                  })
                  .optional(),
              }),
            )
            .max(100)
            .optional(),
        }),
      )
      .max(100)
      .optional(),
  })
  .transform(({ entry }): WhatsAppInboundBatch[] =>
    (entry ?? []).flatMap((item) =>
      (item.changes ?? [])
        .filter((change) => change.field === 'messages' && change.value?.metadata)
        .map((change) => ({
          phoneNumberId: change.value!.metadata!.phone_number_id,
          messages: (change.value!.messages ?? []).map((message) => ({
            id: message.id,
            from: message.from,
            type: message.type,
            image: message.image,
            document: message.document && {
              id: message.document.id,
              mimeType: message.document.mime_type,
            },
          })),
        })),
    ),
  )
  // A notification this bot cannot read is acknowledged, not refused: Meta
  // retries refused deliveries for days.
  .catch([]);

/**
 * Meta calls this URL, so it carries no bearer token: the GET answers the
 * subscription check and every POST is signed with X-Hub-Signature-256.
 */
@Public()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly verifyWebhook: VerifyWebhookUseCase,
    private readonly handleWebhook: HandleWhatsAppWebhookUseCase,
  ) {}

  /** Echoes hub.challenge in plain text when the verify token matches. */
  @Get(':channelId')
  @Header('content-type', 'text/plain; charset=utf-8')
  @Header('cache-control', 'no-store')
  verify(
    @Param('channelId', new ZodValidationPipe(idSchema)) channelId: string,
    @Query(new ZodValidationPipe(webhookVerificationQuerySchema)) query: WebhookVerificationQuery,
  ): Promise<string> {
    return this.verifyWebhook.execute(channelId, {
      mode: query['hub.mode'],
      token: query['hub.verify_token'],
      challenge: query['hub.challenge'],
    });
  }

  @Post(':channelId')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('channelId', new ZodValidationPipe(idSchema)) channelId: string,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body(new ZodValidationPipe(notificationSchema)) batches: WhatsAppInboundBatch[],
    @Req() request: FastifyRequest,
  ): Promise<{ ok: true }> {
    await this.handleWebhook.execute(channelId, signature, request.rawBody, batches);
    return { ok: true };
  }
}
