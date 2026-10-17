import type { ValidationIssue } from '../../../shared/domain/app-error.js';
import { normalizePhoneDigits } from './phone.js';

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

export interface ChannelCredentials {
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  accessToken: string;
  appSecret: string;
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
