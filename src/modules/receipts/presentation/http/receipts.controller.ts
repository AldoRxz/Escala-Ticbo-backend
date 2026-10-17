import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../../shared/infrastructure/http/zod-validation.pipe.js';
import type { Principal } from '../../../iam/application/principal.js';
import { CurrentPrincipal } from '../../../iam/presentation/http/auth.decorators.js';
import {
  GetReceiptImageUseCase,
  ListReceiptsUseCase,
} from '../../application/use-cases/receipts.use-cases.js';
import type { Receipt, ReceiptSource, ReceiptStatus } from '../../domain/receipt.js';

export interface ReceiptResponse {
  id: string;
  source: ReceiptSource;
  status: ReceiptStatus;
  receiver: { id: string; rfc: string; legalName: string } | null;
  cfdiUse: string | null;
  sender: { phone: string | null; label: string | null };
  merchantName: string | null;
  total: string | null;
  purchasedAt: string | null;
  createdAt: string;
}

function toResponse(receipt: Receipt): ReceiptResponse {
  return {
    id: receipt.id,
    source: receipt.source,
    status: receipt.status,
    receiver: receipt.receiver,
    cfdiUse: receipt.cfdiUse,
    sender: { phone: receipt.senderPhone, label: receipt.senderLabel },
    merchantName: receipt.merchantName,
    total: receipt.total,
    purchasedAt: receipt.purchasedAt?.toISOString() ?? null,
    createdAt: receipt.createdAt.toISOString(),
  };
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.uuid().optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

/** Tickets the account's people sent, and their photos. */
@Controller('receipts')
export class ReceiptsController {
  constructor(
    private readonly listReceipts: ListReceiptsUseCase,
    private readonly getImage: GetReceiptImageUseCase,
  ) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ): Promise<{ items: ReceiptResponse[]; nextCursor: string | null }> {
    const page = await this.listReceipts.execute(principal, query);
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
  }

  @Get(':id/image')
  @Header('cache-control', 'private, max-age=300')
  @Header('x-content-type-options', 'nosniff')
  async image(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const image = await this.getImage.execute(principal, id);
    void reply.type(image.contentType);
    return image.body;
  }
}
