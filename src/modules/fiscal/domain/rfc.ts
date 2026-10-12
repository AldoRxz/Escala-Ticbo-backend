/** Persona física (13-character RFC) or persona moral (12 characters). */
export type PersonType = 'fisica' | 'moral';

// Same rule as the fiscal_profiles_rfc_format CHECK constraint.
const RFC_PATTERN = /^([A-ZÑ&]{3,4})([0-9]{2})([0-9]{2})([0-9]{2})[A-Z0-9]{3}$/;

// Público en general and residente en el extranjero: valid RFCs, but never a
// receiver an expense can be deducted for.
const GENERIC_RFCS = new Set(['XAXX010101000', 'XEXX010101000']);

export type RfcProblem = 'invalid_rfc' | 'generic_rfc';

export interface ParsedRfc {
  readonly value: string;
  readonly personType: PersonType;
}

/** Uppercases and drops spaces and dashes, as people often type them. */
export function normalizeRfc(input: string): string {
  return input.replace(/[\s-]+/g, '').toLocaleUpperCase('es-MX');
}

/** The normalized RFC and its person type, or why it cannot be a receiver's RFC. */
export function parseRfc(input: string): ParsedRfc | RfcProblem {
  const value = normalizeRfc(input);
  const match = RFC_PATTERN.exec(value);
  if (!match) {
    return 'invalid_rfc';
  }
  const [, letters, year, month, day] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (!isCalendarDate(Number(year), Number(month), Number(day))) {
    return 'invalid_rfc';
  }
  if (GENERIC_RFCS.has(value)) {
    return 'generic_rfc';
  }
  return { value, personType: letters.length === 4 ? 'fisica' : 'moral' };
}

/** The RFC carries YYMMDD; the century is unknown, so a date valid in either one passes. */
function isCalendarDate(yy: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  return [1900 + yy, 2000 + yy].some(
    (year) => day <= new Date(Date.UTC(year, month, 0)).getUTCDate(),
  );
}
