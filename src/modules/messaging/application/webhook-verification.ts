import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { API_BASE_PATH } from '../../../shared/infrastructure/http/api-path.js';

export abstract class WebhookSettings {
  /** Public base URL of the API, as Meta reaches it. */
  abstract readonly apiPublicUrl: string;
}

/**
 * The webhook URL and verify token a customer registers in Meta's dashboard.
 * Only the token's SHA-256 is stored: the plaintext is shown once.
 */
@Injectable()
export class WebhookVerification {
  constructor(private readonly settings: WebhookSettings) {}

  urlFor(channelId: string): string {
    return `${this.settings.apiPublicUrl}${API_BASE_PATH}/webhooks/whatsapp/${channelId}`;
  }

  newToken(): { token: string; hash: string } {
    const token = randomBytes(24).toString('base64url');
    return { token, hash: hashToken(token) };
  }

  matches(token: string, hash: string): boolean {
    const candidate = Buffer.from(hashToken(token), 'hex');
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
