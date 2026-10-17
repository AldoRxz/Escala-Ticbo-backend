import { Injectable } from '@nestjs/common';
import { WhatsAppUnavailableError } from '../application/errors.js';
import {
  WhatsAppCloudApi,
  WhatsAppMediaTooLargeError,
  WhatsAppTokenRejectedError,
} from '../application/ports/whatsapp-cloud-api.js';

export abstract class WhatsAppCloudSettings {
  /** https://graph.facebook.com, or a fake server in tests. */
  abstract readonly graphUrl: string;
}

// Graph API versions live about two years; bump it with Meta's changelog.
const GRAPH_VERSION = 'v23.0';
const CALL_TIMEOUT_MS = 5_000;
const DOWNLOAD_TIMEOUT_MS = 7_000;

/** Hosts Meta serves media from; the access token is never sent anywhere else. */
const MEDIA_HOSTS = [/\.fbsbx\.com$/, /\.facebook\.com$/, /\.whatsapp\.net$/];

@Injectable()
export class FetchWhatsAppCloudApi extends WhatsAppCloudApi {
  constructor(private readonly settings: WhatsAppCloudSettings) {
    super();
  }

  async downloadMedia(token: string, mediaId: string, maxBytes: number): Promise<Buffer> {
    const media = await this.json<{ url?: string; file_size?: number }>(
      token,
      encodeURIComponent(mediaId),
      { method: 'GET' },
    );
    if ((media.file_size ?? 0) > maxBytes) {
      throw new WhatsAppMediaTooLargeError();
    }
    if (!media.url || !this.isMediaHost(media.url)) {
      throw new WhatsAppUnavailableError({
        cause: new Error('media lookup returned no usable url'),
      });
    }

    const response = await this.fetch(
      media.url,
      { method: 'GET', headers: { authorization: `Bearer ${token}` } },
      DOWNLOAD_TIMEOUT_MS,
    );
    if (response.status === 401) {
      throw new WhatsAppTokenRejectedError();
    }
    if (!response.ok) {
      throw new WhatsAppUnavailableError({
        cause: new Error(`media download answered ${response.status}`),
      });
    }
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
      throw new WhatsAppMediaTooLargeError();
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) {
      throw new WhatsAppMediaTooLargeError();
    }
    return body;
  }

  async sendText(token: string, phoneNumberId: string, to: string, text: string): Promise<void> {
    await this.json(token, `${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      },
    });
  }

  private async json<T>(
    token: string,
    path: string,
    { method, body }: { method: 'GET' | 'POST'; body?: object },
  ): Promise<T> {
    const response = await this.fetch(
      `${this.settings.graphUrl}/${GRAPH_VERSION}/${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      CALL_TIMEOUT_MS,
    );
    const payload = (await response.json().catch(() => null)) as
      (T & { error?: { message?: string; code?: number } }) | null;
    if (response.status === 401 || payload?.error?.code === 190) {
      throw new WhatsAppTokenRejectedError();
    }
    if (!response.ok || !payload) {
      throw new WhatsAppUnavailableError({
        cause: new Error(`Graph API answered ${response.status}: ${payload?.error?.message ?? ''}`),
      });
    }
    return payload;
  }

  private async fetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'Error';
      throw new WhatsAppUnavailableError({
        cause: new Error(`Graph API request failed: ${reason}`),
      });
    }
  }

  private isMediaHost(url: string): boolean {
    const target = new URL(url);
    if (target.origin === new URL(this.settings.graphUrl).origin) {
      return true;
    }
    return target.protocol === 'https:' && MEDIA_HOSTS.some((host) => host.test(target.hostname));
  }
}
