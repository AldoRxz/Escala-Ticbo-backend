import { Injectable } from '@nestjs/common';
import { TelegramUnavailableError } from '../application/errors.js';
import {
  type BotProfile,
  type ReplyKeyboard,
  TelegramApi,
  TelegramFileTooLargeError,
  TelegramTokenRejectedError,
} from '../application/ports/telegram-api.js';

export abstract class TelegramApiSettings {
  /** https://api.telegram.org, or a fake server in tests. */
  abstract readonly baseUrl: string;
}

interface Envelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

// The API Lambda times out at 10 s; a call that takes longer is treated as down.
const CALL_TIMEOUT_MS = 5_000;
const DOWNLOAD_TIMEOUT_MS = 7_000;

/**
 * Telegram's Bot API over fetch. The token is part of every URL, so URLs and
 * request details never go into errors or logs.
 */
@Injectable()
export class FetchTelegramApi extends TelegramApi {
  constructor(private readonly settings: TelegramApiSettings) {
    super();
  }

  async getMe(token: string): Promise<BotProfile> {
    const me = await this.call<{ id: number; username?: string; first_name: string }>(
      token,
      'getMe',
    );
    return { id: me.id, username: me.username ?? String(me.id), displayName: me.first_name };
  }

  async setWebhook(token: string, url: string, secretToken: string): Promise<void> {
    await this.call(token, 'setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message'],
      // Messages sent before the bot was connected are not Ticbo's to process.
      drop_pending_updates: true,
      max_connections: 10,
    });
  }

  async deleteWebhook(token: string): Promise<void> {
    await this.call(token, 'deleteWebhook', { drop_pending_updates: true });
  }

  async sendMessage(
    token: string,
    chatId: number,
    text: string,
    keyboard?: ReplyKeyboard,
  ): Promise<void> {
    await this.call(token, 'sendMessage', {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: replyMarkup(keyboard) } : {}),
    });
  }

  async downloadFile(token: string, fileId: string, maxBytes: number): Promise<Buffer> {
    const file = await this.call<{ file_path?: string; file_size?: number }>(token, 'getFile', {
      file_id: fileId,
    });
    if ((file.file_size ?? 0) > maxBytes) {
      throw new TelegramFileTooLargeError();
    }
    if (!file.file_path) {
      throw new TelegramUnavailableError({ cause: new Error('getFile returned no file_path') });
    }
    const response = await this.fetch(
      `${this.settings.baseUrl}/file/bot${token}/${file.file_path}`,
      { method: 'GET' },
      DOWNLOAD_TIMEOUT_MS,
      'file download',
    );
    if (!response.ok) {
      throw new TelegramUnavailableError({
        cause: new Error(`file download answered ${response.status}`),
      });
    }
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
      throw new TelegramFileTooLargeError();
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) {
      throw new TelegramFileTooLargeError();
    }
    return body;
  }

  private async call<T>(token: string, method: string, body: object = {}): Promise<T> {
    const response = await this.fetch(
      `${this.settings.baseUrl}/bot${token}/${method}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      CALL_TIMEOUT_MS,
      method,
    );
    const envelope = (await response.json().catch(() => null)) as Envelope<T> | null;
    // 401: revoked or unknown token; 404: a token Telegram cannot even parse.
    if (response.status === 401 || response.status === 404) {
      throw new TelegramTokenRejectedError();
    }
    if (!response.ok || !envelope?.ok) {
      throw new TelegramUnavailableError({
        cause: new Error(`${method} answered ${response.status}: ${envelope?.description ?? ''}`),
      });
    }
    return envelope.result as T;
  }

  private async fetch(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    what: string,
  ): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // The cause would carry the URL, and with it the token: keep only its kind.
      const reason = error instanceof Error ? error.name : 'Error';
      throw new TelegramUnavailableError({ cause: new Error(`${what} failed: ${reason}`) });
    }
  }
}

function replyMarkup(keyboard: ReplyKeyboard): object {
  if (keyboard.kind === 'remove') {
    return { remove_keyboard: true };
  }
  return {
    keyboard: [[{ text: keyboard.label, request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}
