import { InvalidEmailError } from './errors.js';

export const EMAIL_MAX_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalized email address (trimmed, lower-cased). It is the unique sign-in identifier. */
export class Email {
  private constructor(readonly value: string) {}

  static parse(raw: string): Email {
    const value = raw.trim().toLowerCase();
    if (value.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(value)) {
      throw new InvalidEmailError();
    }
    return new Email(value);
  }

  toString(): string {
    return this.value;
  }
}
