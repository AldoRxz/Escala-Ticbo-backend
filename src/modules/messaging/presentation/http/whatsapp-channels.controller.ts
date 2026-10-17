import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../../../shared/infrastructure/http/zod-validation.pipe.js';
import type { Principal } from '../../../iam/application/principal.js';
import { CurrentPrincipal } from '../../../iam/presentation/http/auth.decorators.js';
import { ConnectWhatsAppChannelUseCase } from '../../application/use-cases/connect-whatsapp-channel.use-case.js';
import { DisconnectWhatsAppChannelUseCase } from '../../application/use-cases/disconnect-whatsapp-channel.use-case.js';
import { ListWhatsAppChannelsUseCase } from '../../application/use-cases/list-whatsapp-channels.use-case.js';
import {
  AddSenderUseCase,
  RemoveSenderUseCase,
  UpdateSenderUseCase,
} from '../../application/use-cases/manage-senders.use-cases.js';
import { RotateVerifyTokenUseCase } from '../../application/use-cases/rotate-verify-token.use-case.js';
import { WebhookVerification } from '../../application/webhooks.js';
import {
  type ChannelResponse,
  type SenderResponse,
  toChannelResponse,
  toSenderResponse,
} from './whatsapp.responses.js';
import {
  type AddSenderBody,
  addSenderBodySchema,
  type ConnectChannelBody,
  connectChannelBodySchema,
  idSchema,
  type UpdateSenderBody,
  updateSenderBodySchema,
} from './whatsapp.schemas.js';

const idPipe = new ZodValidationPipe(idSchema);

/** The active account's WhatsApp Business numbers and the phones allowed to use them. */
@Controller('whatsapp/channels')
export class WhatsAppChannelsController {
  constructor(
    private readonly listChannels: ListWhatsAppChannelsUseCase,
    private readonly connectChannel: ConnectWhatsAppChannelUseCase,
    private readonly disconnectChannel: DisconnectWhatsAppChannelUseCase,
    private readonly rotateVerifyToken: RotateVerifyTokenUseCase,
    private readonly addSender: AddSenderUseCase,
    private readonly updateSender: UpdateSenderUseCase,
    private readonly removeSender: RemoveSenderUseCase,
    private readonly webhooks: WebhookVerification,
  ) {}

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<{ items: ChannelResponse[] }> {
    const channels = await this.listChannels.execute(principal);
    return {
      items: channels.map((channel) =>
        toChannelResponse(channel, this.webhooks.urlFor(channel.id)),
      ),
    };
  }

  /** Answers the verify token once; register it in Meta with the webhook URL. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async connect(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(connectChannelBodySchema)) body: ConnectChannelBody,
  ): Promise<ChannelResponse & { verifyToken: string }> {
    const { channel, verifyToken } = await this.connectChannel.execute(principal, body);
    return { ...toChannelResponse(channel, this.webhooks.urlFor(channel.id)), verifyToken };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(
    @CurrentPrincipal() principal: Principal,
    @Param('id', idPipe) id: string,
  ): Promise<void> {
    await this.disconnectChannel.execute(principal, id);
  }

  @Post(':id/verify-token')
  @HttpCode(HttpStatus.OK)
  async newVerifyToken(
    @CurrentPrincipal() principal: Principal,
    @Param('id', idPipe) id: string,
  ): Promise<{ verifyToken: string }> {
    return { verifyToken: await this.rotateVerifyToken.execute(principal, id) };
  }

  @Post(':id/senders')
  @HttpCode(HttpStatus.CREATED)
  async authorizeSender(
    @CurrentPrincipal() principal: Principal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(addSenderBodySchema)) body: AddSenderBody,
  ): Promise<SenderResponse> {
    return toSenderResponse(await this.addSender.execute(principal, id, body));
  }

  @Patch(':id/senders/:senderId')
  async editSender(
    @CurrentPrincipal() principal: Principal,
    @Param('id', idPipe) id: string,
    @Param('senderId', idPipe) senderId: string,
    @Body(new ZodValidationPipe(updateSenderBodySchema)) body: UpdateSenderBody,
  ): Promise<SenderResponse> {
    return toSenderResponse(await this.updateSender.execute(principal, id, senderId, body));
  }

  @Delete(':id/senders/:senderId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSender(
    @CurrentPrincipal() principal: Principal,
    @Param('id', idPipe) id: string,
    @Param('senderId', idPipe) senderId: string,
  ): Promise<void> {
    await this.removeSender.execute(principal, id, senderId);
  }
}
