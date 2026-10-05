import { describe, expect, it } from 'vitest';
import { Email } from './email.js';
import { InvalidEmailError, WeakPasswordError } from './errors.js';
import { decideOAuthLink } from './oauth.js';
import { assertAcceptablePassword, normalizePassword } from './password.js';

describe('Email', () => {
  it('trims and lower-cases the address', () => {
    expect(Email.parse('  Aldo@Ticbo.COM ').value).toBe('aldo@ticbo.com');
  });

  it.each(['', 'aldo', 'aldo@', 'aldo@ticbo', 'al do@ticbo.com', `${'a'.repeat(250)}@x.mx`])(
    'rejects %j',
    (raw) => {
      expect(() => Email.parse(raw)).toThrow(InvalidEmailError);
    },
  );
});

describe('password policy', () => {
  it('accepts 12 to 128 characters with no composition rules', () => {
    expect(() => assertAcceptablePassword('todo minúsculas')).not.toThrow();
    expect(() => assertAcceptablePassword('x'.repeat(128))).not.toThrow();
  });

  it('rejects passwords that are too short or too long', () => {
    expect(() => assertAcceptablePassword('short')).toThrow(WeakPasswordError);
    expect(() => assertAcceptablePassword('x'.repeat(129))).toThrow(WeakPasswordError);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(() => assertAcceptablePassword('🔐'.repeat(12))).not.toThrow();
  });

  it('normalizes equivalent Unicode forms to the same string', () => {
    expect(normalizePassword('café')).toBe(normalizePassword('café'));
  });
});

describe('decideOAuthLink', () => {
  it('links to a user whose email is verified', () => {
    expect(decideOAuthLink({ emailVerifiedAt: new Date(), passwordHash: 'hash' })).toBe('link');
  });

  it('resets credentials of an unverified password account (pre-account takeover)', () => {
    expect(decideOAuthLink({ emailVerifiedAt: null, passwordHash: 'hash' })).toBe(
      'link_and_reset_credentials',
    );
  });

  it('links when there is no password to distrust', () => {
    expect(decideOAuthLink({ emailVerifiedAt: null, passwordHash: null })).toBe('link');
  });
});
