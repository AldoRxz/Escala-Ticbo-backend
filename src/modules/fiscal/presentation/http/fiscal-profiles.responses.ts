import { CFDI_USES, TAX_REGIMES } from '../../domain/catalogs.js';
import { type FiscalProfile, personTypeOf } from '../../domain/fiscal-profile.js';
import type { PersonType } from '../../domain/rfc.js';

export interface FiscalProfileResponse {
  id: string;
  rfc: string;
  personType: PersonType;
  legalName: string;
  taxRegime: string;
  postalCode: string;
  defaultCfdiUse: string;
  invoiceEmail: string;
  isDefault: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

export function toFiscalProfileResponse(profile: FiscalProfile): FiscalProfileResponse {
  return {
    id: profile.id,
    rfc: profile.rfc,
    personType: personTypeOf(profile.rfc),
    legalName: profile.legalName,
    taxRegime: profile.taxRegime,
    postalCode: profile.postalCode,
    defaultCfdiUse: profile.defaultCfdiUse,
    invoiceEmail: profile.invoiceEmail,
    isDefault: profile.isDefault,
    verifiedAt: profile.verifiedAt?.toISOString() ?? null,
    createdAt: profile.createdAt.toISOString(),
  };
}

export interface FiscalCatalogResponse {
  taxRegimes: typeof TAX_REGIMES;
  cfdiUses: typeof CFDI_USES;
}

export const FISCAL_CATALOG: FiscalCatalogResponse = {
  taxRegimes: TAX_REGIMES,
  cfdiUses: CFDI_USES,
};
