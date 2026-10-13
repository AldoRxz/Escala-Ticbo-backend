import type { ValidationIssue } from '../../../shared/domain/app-error.js';
import { findCfdiUse, findTaxRegime } from './catalogs.js';
import { type PersonType, parseRfc } from './rfc.js';

export const LEGAL_NAME_MAX_LENGTH = 300;

/** Receiver data a merchant's invoicing portal asks for. */
export interface FiscalProfile {
  readonly id: string;
  readonly accountId: string;
  readonly rfc: string;
  readonly legalName: string;
  readonly taxRegime: string;
  readonly postalCode: string;
  /** CFDI use the bot invoices with unless the person picks another; null: it asks each time. */
  readonly defaultCfdiUse: string | null;
  /** Ticbo inbox alias typed into portals so the CFDI reaches Ticbo. */
  readonly invoiceEmail: string;
  readonly isDefault: boolean;
  readonly verifiedAt: Date | null;
  readonly createdAt: Date;
}

export interface FiscalData {
  rfc: string;
  legalName: string;
  taxRegime: string;
  postalCode: string;
  /** Optional: null or empty means no suggested use. */
  defaultCfdiUse: string | null;
}

export function personTypeOf(rfc: string): PersonType {
  // Stored RFCs are always valid: 4 leading letters for a person, 3 for a company.
  return /^[A-ZÑ&]{4}/.test(rfc) ? 'fisica' : 'moral';
}

/** Collapses runs of spaces and uppercases, as the Constancia de Situación Fiscal shows it. */
export function normalizeLegalName(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-MX');
}

const issue = (path: keyof FiscalData, code: string, message: string): ValidationIssue => ({
  path,
  code,
  message,
});

/**
 * Normalizes `input` and checks it against the SAT rules for a CFDI 4.0 receiver:
 * RFC format, a regime that applies to that kind of person and, if one is given,
 * a CFDI use the SAT accepts with that regime. Returns the clean data or every
 * problem found.
 */
export function validateFiscalData(
  input: FiscalData,
): { ok: true; value: FiscalData } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  const rfc = parseRfc(input.rfc);
  if (rfc === 'invalid_rfc') {
    issues.push(issue('rfc', 'invalid_rfc', 'The RFC does not have a valid format.'));
  } else if (rfc === 'generic_rfc') {
    issues.push(issue('rfc', 'generic_rfc', 'Generic RFCs cannot receive deductible invoices.'));
  }
  const personType = typeof rfc === 'string' ? null : rfc.personType;

  const legalName = normalizeLegalName(input.legalName);
  if (legalName.length === 0 || legalName.length > LEGAL_NAME_MAX_LENGTH) {
    issues.push(
      issue('legalName', 'invalid_legal_name', 'Type the legal name as it appears with the SAT.'),
    );
  }

  const postalCode = input.postalCode.trim();
  if (!/^[0-9]{5}$/.test(postalCode)) {
    issues.push(issue('postalCode', 'invalid_postal_code', 'The postal code has 5 digits.'));
  }

  const regime = findTaxRegime(input.taxRegime.trim());
  if (!regime) {
    issues.push(issue('taxRegime', 'unknown_tax_regime', 'Choose a regime from the SAT catalog.'));
  } else if (personType && !regime.personTypes.includes(personType)) {
    issues.push(
      issue(
        'taxRegime',
        'tax_regime_not_allowed',
        `Regime ${regime.code} does not apply to this RFC.`,
      ),
    );
  }

  const useCode = input.defaultCfdiUse?.trim().toUpperCase() ?? '';
  const use = useCode === '' ? null : findCfdiUse(useCode);
  if (use === undefined) {
    issues.push(
      issue('defaultCfdiUse', 'unknown_cfdi_use', 'Choose a CFDI use from the SAT catalog.'),
    );
  } else if (
    use &&
    ((personType && !use.personTypes.includes(personType)) ||
      (regime && !use.taxRegimes.includes(regime.code)))
  ) {
    issues.push(
      issue(
        'defaultCfdiUse',
        'cfdi_use_not_allowed',
        `Use ${use.code} is not accepted with this RFC and regime.`,
      ),
    );
  }

  if (issues.length > 0 || typeof rfc === 'string' || !regime || use === undefined) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      rfc: rfc.value,
      legalName,
      taxRegime: regime.code,
      postalCode,
      defaultCfdiUse: use?.code ?? null,
    },
  };
}
