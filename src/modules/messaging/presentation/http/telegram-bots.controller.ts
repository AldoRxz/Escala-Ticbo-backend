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
import {
  AddTelegramSenderUseCase,
  ConnectTelegramBotUseCase,
  DisconnectTelegramBotUseCase,
  ListTelegramBotsUseCase,
  RemoveTelegramSenderUseCase,
  UpdateTelegramSenderUseCase,
} from '../../application/use-cases/telegram-bots.use-cases.js';
import {
  type TelegramBotResponse,
  type TelegramSenderResponse,
  toTelegramBotResponse,
  toTelegramSenderResponse,
} from './telegram.responses.js';
import {
  type AddTelegramSenderBody,
  addTelegramSenderBodySchema,
  type ConnectBotBody,
  connectBotBodySchema,
  type UpdateTelegramSenderBody,
  updateTelegramSenderBodySchema,
} from './telegram.schemas.js';
import { idSchema } from './whatsapp.schemas.js';

const idPipe = new ZodValidationPipe(idSchema);

/** The active account's Telegram bots and the phones allowed to use them. */
@Controller('telegram/bots')
export class TelegramBotsController {
  constructor(
    private readonly listBots: ListTelegramBotsUseCase,
    private readonly connectBot: ConnectTelegramBotUseCase,
    private readonly disconnectBot: DisconnectTelegramBotUseCase,
    private readonly addSender: AddTelegramSenderUseCase,
    private readonly updateSender: UpdateTelegramSenderUseCase,
    private readonly removeSender: RemoveTelegramSenderUseCase,
  ) {}

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<{ items: TelegramBotResponse[] }> {
    const bots = await this.listBots.execute(principal);
    return { items: bots.map(toTelegramBotResponse) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async connect(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(connectBotBodySchema)) body: ConnectBotBody,
  ): Promise<TelegramBotResponse> {
    return toTelegramBotResponse(await this.connectBot.execute(principal, body));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(
    @CurrentPrincipal() principal: Principal,
    @Param('id', idPipe) id: string,
  ): Promise<void> {
    await this.disconnectBot.execute(principal, id);
  }

  @Post(':id/senders')
  @HttpCode(HttpStatus.CREATED)
  async authorizeSender(
    @CurrentPrincipal() principal: Principal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(addTelegramSenderBodySchema)) body: AddTelegramSenderBody,
  ): Promise<TelegramSenderResponse> {
    return toTelegramSenderResponse(await this.addSender.execute(principal, id, body));
  }

  @Patch(':id/senders/:senderId')
  async editSender(
    @CurrentPrincipal() principal: Principal,
    @Param('id', idPipe) id: string,
    @Param('senderId', idPipe) senderId: string,
    @Body(new ZodValidationPipe(updateTelegramSenderBodySchema)) body: UpdateTelegramSenderBody,
  ): Promise<TelegramSenderResponse> {
    return toTelegramSenderResponse(await this.updateSender.execute(principal, id, senderId, body));
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
