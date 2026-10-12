import { Injectable } from '@nestjs/common';
import { activeAccountOf } from '../../../iam/application/authorization.js';
import type { Principal } from '../../../iam/application/principal.js';
import type { WhatsAppChannel } from '../../domain/whatsapp.js';
import { WhatsAppChannelRepository } from '../ports/whatsapp-channel.repository.js';

/** The account's numbers and their authorized phones; any member can see them. */
@Injectable()
export class ListWhatsAppChannelsUseCase {
  constructor(private readonly channels: WhatsAppChannelRepository) {}

  async execute(principal: Principal): Promise<WhatsAppChannel[]> {
    return this.channels.list(activeAccountOf(principal));
  }
}
