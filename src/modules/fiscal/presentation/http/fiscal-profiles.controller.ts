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
import { CreateFiscalProfileUseCase } from '../../application/use-cases/create-fiscal-profile.use-case.js';
import { DeleteFiscalProfileUseCase } from '../../application/use-cases/delete-fiscal-profile.use-case.js';
import { ListFiscalProfilesUseCase } from '../../application/use-cases/list-fiscal-profiles.use-case.js';
import { MakeDefaultFiscalProfileUseCase } from '../../application/use-cases/make-default-fiscal-profile.use-case.js';
import { UpdateFiscalProfileUseCase } from '../../application/use-cases/update-fiscal-profile.use-case.js';
import {
  FISCAL_CATALOG,
  type FiscalCatalogResponse,
  type FiscalProfileResponse,
  toFiscalProfileResponse,
} from './fiscal-profiles.responses.js';
import {
  type CreateFiscalProfileBody,
  createFiscalProfileBodySchema,
  fiscalProfileIdSchema,
  type UpdateFiscalProfileBody,
  updateFiscalProfileBodySchema,
} from './fiscal-profiles.schemas.js';

const idPipe = new ZodValidationPipe(fiscalProfileIdSchema);

/** The RFCs (receivers) of the caller's active account. */
@Controller('fiscal-profiles')
export class FiscalProfilesController {
  constructor(
    private readonly listProfiles: ListFiscalProfilesUseCase,
    private readonly createProfile: CreateFiscalProfileUseCase,
    private readonly updateProfile: UpdateFiscalProfileUseCase,
    private readonly makeDefaultProfile: MakeDefaultFiscalProfileUseCase,
    private readonly deleteProfile: DeleteFiscalProfileUseCase,
  ) {}

  /** SAT regimes and CFDI uses with the rules that tie them to an RFC. */
  @Get('catalog')
  catalog(): FiscalCatalogResponse {
    return FISCAL_CATALOG;
  }

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ items: FiscalProfileResponse[] }> {
    const profiles = await this.listProfiles.execute(principal);
    return { items: profiles.map(toFiscalProfileResponse) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createFiscalProfileBodySchema)) body: CreateFiscalProfileBody,
  ): Promise<FiscalProfileResponse> {
    return toFiscalProfileResponse(await this.createProfile.execute(principal, body));
  }

  @Patch(':id')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateFiscalProfileBodySchema)) body: UpdateFiscalProfileBody,
  ): Promise<FiscalProfileResponse> {
    return toFiscalProfileResponse(await this.updateProfile.execute(principal, id, body));
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  async makeDefault(
    @CurrentPrincipal() principal: Principal,
    @Param('id', idPipe) id: string,
  ): Promise<FiscalProfileResponse> {
    return toFiscalProfileResponse(await this.makeDefaultProfile.execute(principal, id));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', idPipe) id: string,
  ): Promise<void> {
    await this.deleteProfile.execute(principal, id);
  }
}
