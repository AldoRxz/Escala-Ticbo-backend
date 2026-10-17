import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { API_BASE_PATH } from '../../../shared/infrastructure/http/api-path.js';

export abstract class WebhookSettings {
  /** Public base URL of the API, as Meta and Telegram reach it. */
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
    return newSecretToken();
  }

  matches(token: string, hash: string): boolean {
    return secretMatches(token, hash);
  }
}

/**
 * The webhook URL Ticbo registers for a Telegram bot and the secret Telegram
 * sends back with every update. Only the secret's SHA-256 is stored.
 */
@Injectable()
export class TelegramWebhooks {
  constructor(private readonly settings: WebhookSettings) {}

  urlFor(botId: string): string {
    return `${this.settings.apiPublicUrl}${API_BASE_PATH}/webhooks/telegram/${botId}`;
  }

  newSecret(): { token: string; hash: string } {
    return newSecretToken();
  }

  matches(secret: string, hash: string): boolean {
    return secretMatches(secret, hash);
  }
}

/** 32 random characters of [A-Za-z0-9_-], which both Meta and Telegram accept. */
function newSecretToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: hashToken(token) };
}

function secretMatches(token: string, hash: string): boolean {
  const candidate = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
