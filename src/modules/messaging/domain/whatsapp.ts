import type { ValidationIssue } from '../../../shared/domain/app-error.js';

export type WhatsAppChannelStatus = 'pending_verification' | 'active' | 'disabled';

/** A customer's WhatsApp Business number connected through Meta's Cloud API. */
export interface WhatsAppChannel {
  readonly id: string;
  readonly accountId: string;
  readonly phoneNumberId: string;
  readonly businessAccountId: string;
  readonly displayPhoneNumber: string;
  readonly status: WhatsAppChannelStatus;
  readonly createdAt: Date;
  readonly senders: readonly WhatsAppSender[];
}

/** A phone allowed to send receipts to a channel. */
export interface WhatsAppSender {
  readonly id: string;
  readonly channelId: string;
  /** Country code and number, digits only, as WhatsApp reports the sender. */
  readonly waId: string;
  readonly label: string | null;
  readonly defaultFiscalProfileId: string | null;
  readonly createdAt: Date;
}

export const SENDER_LABEL_MAX_LENGTH = 80;

export interface ChannelCredentials {
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  accessToken: string;
  appSecret: string;
}

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

const issue = (path: string, code: string, message: string): ValidationIssue => ({
  path,
  code,
  message,
});

/** Normalizes the credentials copied from Meta's app dashboard, or lists what is wrong. */
export function validateCredentials(
  input: ChannelCredentials,
): { ok: true; value: ChannelCredentials } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const phoneNumberId = input.phoneNumberId.trim();
  const businessAccountId = input.businessAccountId.trim();
  const phone = normalizePhoneDigits(input.displayPhoneNumber);
  const accessToken = input.accessToken.trim();
  const appSecret = input.appSecret.trim().toLowerCase();

  if (!/^[0-9]{5,32}$/.test(phoneNumberId)) {
    issues.push(
      issue('phoneNumberId', 'invalid_phone_number_id', 'The phone number ID is a number.'),
    );
  }
  if (!/^[0-9]{5,32}$/.test(businessAccountId)) {
    issues.push(
      issue('businessAccountId', 'invalid_business_account_id', 'The WABA ID is a number.'),
    );
  }
  if (!phone) {
    issues.push(
      issue('displayPhoneNumber', 'invalid_phone', 'Type the number with its country code.'),
    );
  }
  if (!/^[A-Za-z0-9_.|-]{20,2048}$/.test(accessToken)) {
    issues.push(issue('accessToken', 'invalid_access_token', 'Paste the full access token.'));
  }
  // Meta app secrets are 32 hexadecimal characters.
  if (!/^[a-f0-9]{32}$/.test(appSecret)) {
    issues.push(issue('appSecret', 'invalid_app_secret', 'The app secret has 32 characters.'));
  }

  if (issues.length > 0 || !phone) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      phoneNumberId,
      businessAccountId,
      displayPhoneNumber: `+${phone}`,
      accessToken,
      appSecret,
    },
  };
}

/** Trims the label; an empty one means "no label". */
export function normalizeSenderLabel(input: string | null | undefined): string | null {
  const label = input?.trim().replace(/\s+/g, ' ') ?? '';
  return label === '' ? null : label.slice(0, SENDER_LABEL_MAX_LENGTH);
}
