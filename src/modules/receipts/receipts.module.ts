import { Module } from '@nestjs/common';
import { ReceiptRepository } from './application/ports/receipt.repository.js';
import {
  GetReceiptImageUseCase,
  IngestReceiptUseCase,
  ListReceiptsUseCase,
} from './application/use-cases/receipts.use-cases.js';
import { DrizzleReceiptRepository } from './infrastructure/drizzle-receipt.repository.js';
import { ReceiptsController } from './presentation/http/receipts.controller.js';

/** Tickets: the photo someone sent and where it is in the pipeline to its CFDI. */
@Module({
  controllers: [ReceiptsController],
  providers: [
    { provide: ReceiptRepository, useClass: DrizzleReceiptRepository },
    IngestReceiptUseCase,
    ListReceiptsUseCase,
    GetReceiptImageUseCase,
  ],
  exports: [IngestReceiptUseCase],
})
export class ReceiptsModule {}
