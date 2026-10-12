import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../../../../shared/infrastructure/http/zod-validation.pipe.js';
import { Public } from '../../../iam/presentation/http/auth.decorators.js';
import { VerifyWebhookUseCase } from '../../application/use-cases/verify-webhook.use-case.js';
import {
  idSchema,
  type WebhookVerificationQuery,
  webhookVerificationQuerySchema,
} from './whatsapp.schemas.js';

/**
 * Meta calls this URL, so it carries no bearer token. Today it answers the
 * subscription check; incoming messages (POST, signed with X-Hub-Signature-256)
 * arrive with the receipts pipeline.
 */
@Public()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly verifyWebhook: VerifyWebhookUseCase) {}

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
}
