import { describe, expect, it } from 'vitest';
import { type FiscalData, validateFiscalData } from './fiscal-profile.js';
import { parseRfc } from './rfc.js';

const company: FiscalData = {
  rfc: 'gas190214 8k3',
  legalName: '  Grupo   Andina ',
  taxRegime: '601',
  postalCode: '06600',
  defaultCfdiUse: 'g03',
};

const person: FiscalData = {
  rfc: 'LOTM850315AB1',
  legalName: 'Mariana López Torres',
  taxRegime: '612',
  postalCode: '64000',
  defaultCfdiUse: 'G03',
};

const codes = (data: FiscalData) => {
  const result = validateFiscalData(data);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}:${issue.code}`);
};

describe('parseRfc', () => {
  it('tells a company (12 characters) from a person (13)', () => {
    expect(parseRfc('GAS1902148K3')).toEqual({ value: 'GAS1902148K3', personType: 'moral' });
    expect(parseRfc('LOTM850315AB1')).toEqual({ value: 'LOTM850315AB1', personType: 'fisica' });
  });

  it('accepts Ñ and & and normalizes spaces, dashes and case', () => {
    expect(parseRfc('ñoñ-850315-ab1')).toEqual({ value: 'ÑOÑ850315AB1', personType: 'moral' });
    expect(parseRfc('A&B 850315 AB1')).toMatchObject({ value: 'A&B850315AB1' });
  });

  it('rejects malformed RFCs and impossible dates', () => {
    expect(parseRfc('GAS19021')).toBe('invalid_rfc');
    expect(parseRfc('GAS1913148K3')).toBe('invalid_rfc'); // month 13
    expect(parseRfc('GAS1902308K3')).toBe('invalid_rfc'); // February 30
    expect(parseRfc('GAS0002298K3')).toMatchObject({ personType: 'moral' }); // 29/02/2000
  });

  it('rejects the generic RFCs', () => {
    expect(parseRfc('XAXX010101000')).toBe('generic_rfc');
    expect(parseRfc('XEXX010101000')).toBe('generic_rfc');
  });
});

describe('validateFiscalData', () => {
  it('normalizes valid data', () => {
    expect(validateFiscalData(company)).toEqual({
      ok: true,
      value: {
        rfc: 'GAS1902148K3',
        legalName: 'GRUPO ANDINA',
        taxRegime: '601',
        postalCode: '06600',
        defaultCfdiUse: 'G03',
      },
    });
  });

  it('reports every invalid field at once', () => {
    expect(
      codes({
        rfc: 'ABC',
        legalName: ' ',
        taxRegime: '999',
        postalCode: '123',
        defaultCfdiUse: 'Z99',
      }),
    ).toEqual([
      'rfc:invalid_rfc',
      'legalName:invalid_legal_name',
      'postalCode:invalid_postal_code',
      'taxRegime:unknown_tax_regime',
      'defaultCfdiUse:unknown_cfdi_use',
    ]);
  });

  it('only accepts regimes that apply to the kind of person', () => {
    expect(codes({ ...company, taxRegime: '612' })).toContain('taxRegime:tax_regime_not_allowed');
    expect(codes({ ...person, taxRegime: '601' })).toContain('taxRegime:tax_regime_not_allowed');
    expect(codes({ ...company, taxRegime: '626' })).toEqual([]);
    expect(codes({ ...person, taxRegime: '626' })).toEqual([]);
  });

  it('only accepts CFDI uses the SAT allows with the regime', () => {
    // Personal deductions are for people, and not under RESICO.
    expect(codes({ ...company, defaultCfdiUse: 'D01' })).toContain(
      'defaultCfdiUse:cfdi_use_not_allowed',
    );
    expect(codes({ ...person, taxRegime: '626', defaultCfdiUse: 'D01' })).toContain(
      'defaultCfdiUse:cfdi_use_not_allowed',
    );
    expect(codes({ ...person, defaultCfdiUse: 'D01' })).toEqual([]);
    // Salaried people cannot deduct general expenses.
    expect(codes({ ...person, taxRegime: '605', defaultCfdiUse: 'G03' })).toContain(
      'defaultCfdiUse:cfdi_use_not_allowed',
    );
    expect(codes({ ...person, taxRegime: '605', defaultCfdiUse: 'S01' })).toEqual([]);
  });
});
