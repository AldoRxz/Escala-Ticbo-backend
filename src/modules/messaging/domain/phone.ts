const MEXICO_COUNTRY_CODE = '52';

/**
 * Digits with the country code. Ten digits are a Mexican number typed without it.
 * Null when it cannot be a phone number (E.164 allows up to 15 digits).
 */
export function normalizePhoneDigits(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const full = digits.length === 10 ? MEXICO_COUNTRY_CODE + digits : digits;
  return full.length >= 11 && full.length <= 15 ? full : null;
}

/**
 * The forms one phone can take. Mexican mobiles used to carry a 1 after the
 * country code (52 1 55…) and WhatsApp still reports many of them that way,
 * while people type them without it; both name the same line.
 */
export function phoneVariants(digits: string): string[] {
  if (digits.length === 12 && digits.startsWith(MEXICO_COUNTRY_CODE)) {
    return [digits, `${MEXICO_COUNTRY_CODE}1${digits.slice(2)}`];
  }
  if (digits.length === 13 && digits.startsWith(`${MEXICO_COUNTRY_CODE}1`)) {
    return [digits, MEXICO_COUNTRY_CODE + digits.slice(3)];
  }
  return [digits];
}

/** The number to send messages to: Mexican mobiles without the old 1. */
export function dialablePhone(digits: string): string {
  return digits.length === 13 && digits.startsWith(`${MEXICO_COUNTRY_CODE}1`)
    ? MEXICO_COUNTRY_CODE + digits.slice(3)
    : digits;
}
