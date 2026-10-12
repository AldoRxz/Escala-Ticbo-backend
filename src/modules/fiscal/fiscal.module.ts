import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import {
  InvoiceEmailAllocator,
  InvoiceMailboxSettings,
} from './application/invoice-email-allocator.js';
import { FiscalProfileRepository } from './application/ports/fiscal-profile.repository.js';
import { CreateFiscalProfileUseCase } from './application/use-cases/create-fiscal-profile.use-case.js';
import { DeleteFiscalProfileUseCase } from './application/use-cases/delete-fiscal-profile.use-case.js';
import { ListFiscalProfilesUseCase } from './application/use-cases/list-fiscal-profiles.use-case.js';
import { MakeDefaultFiscalProfileUseCase } from './application/use-cases/make-default-fiscal-profile.use-case.js';
import { UpdateFiscalProfileUseCase } from './application/use-cases/update-fiscal-profile.use-case.js';
import { DrizzleFiscalProfileRepository } from './infrastructure/drizzle-fiscal-profile.repository.js';
import { FiscalProfilesController } from './presentation/http/fiscal-profiles.controller.js';

/** Receivers' fiscal data (RFC, regime, postal code, CFDI use) per account. */
@Module({
  controllers: [FiscalProfilesController],
  providers: [
    { provide: FiscalProfileRepository, useClass: DrizzleFiscalProfileRepository },
    {
      provide: InvoiceMailboxSettings,
      inject: [AppConfig],
      useFactory: (config: AppConfig): InvoiceMailboxSettings => config.invoiceMailbox,
    },
    InvoiceEmailAllocator,
    ListFiscalProfilesUseCase,
    CreateFiscalProfileUseCase,
    UpdateFiscalProfileUseCase,
    MakeDefaultFiscalProfileUseCase,
    DeleteFiscalProfileUseCase,
  ],
  exports: [FiscalProfileRepository],
})
export class FiscalModule {}
