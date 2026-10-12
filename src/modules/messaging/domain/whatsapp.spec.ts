import { describe, expect, it } from 'vitest';
import { normalizePhoneDigits, normalizeSenderLabel, validateCredentials } from './whatsapp.js';

const credentials = {
  phoneNumberId: ' 106540352242922 ',
  businessAccountId: '102290129340398',
  displayPhoneNumber: '55 1234 5678',
  accessToken: 'EAAGm0PX4ZCpsBAKZB1234567890abcdefghij',
  appSecret: '0123456789ABCDEF0123456789abcdef',
};

describe('normalizePhoneDigits', () => {
  it('adds the Mexican country code to a 10-digit number', () => {
    expect(normalizePhoneDigits('(55) 1234-5678')).toBe('525512345678');
  });

  it('keeps numbers that already carry a country code', () => {
    expect(normalizePhoneDigits('+52 1 55 1234 5678')).toBe('5215512345678');
    expect(normalizePhoneDigits('+1 415 555 0100')).toBe('14155550100');
  });

  it('rejects what cannot be a phone number', () => {
    expect(normalizePhoneDigits('12345')).toBeNull();
    expect(normalizePhoneDigits('1234567890123456')).toBeNull();
  });
});

describe('validateCredentials', () => {
  it('normalizes what is copied from the Meta dashboard', () => {
    expect(validateCredentials(credentials)).toEqual({
      ok: true,
      value: {
        phoneNumberId: '106540352242922',
        businessAccountId: '102290129340398',
        displayPhoneNumber: '+525512345678',
        accessToken: 'EAAGm0PX4ZCpsBAKZB1234567890abcdefghij',
        appSecret: '0123456789abcdef0123456789abcdef',
      },
    });
  });

  it('reports every wrong field', () => {
    const result = validateCredentials({
      phoneNumberId: 'abc',
      businessAccountId: '12',
      displayPhoneNumber: '123',
      accessToken: 'short',
      appSecret: 'not-hex',
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((issue) => issue.code)).toEqual([
      'invalid_phone_number_id',
      'invalid_business_account_id',
      'invalid_phone',
      'invalid_access_token',
      'invalid_app_secret',
    ]);
  });
});

describe('normalizeSenderLabel', () => {
  it('trims and treats an empty label as none', () => {
    expect(normalizeSenderLabel('  Juan   ventas ')).toBe('Juan ventas');
    expect(normalizeSenderLabel('   ')).toBeNull();
    expect(normalizeSenderLabel(undefined)).toBeNull();
  });
});
