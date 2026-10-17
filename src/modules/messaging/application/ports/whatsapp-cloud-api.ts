/** Meta does not accept the access token anymore (expired or revoked). */
export class WhatsAppTokenRejectedError extends Error {}

/** The media is larger than the caller accepts. */
export class WhatsAppMediaTooLargeError extends Error {}

/**
 * Meta's WhatsApp Cloud API, called with each channel's own access token.
 * Failures to reach Meta throw WhatsAppUnavailableError.
 */
export abstract class WhatsAppCloudApi {
  /** @throws WhatsAppTokenRejectedError, WhatsAppMediaTooLargeError */
  abstract downloadMedia(token: string, mediaId: string, maxBytes: number): Promise<Buffer>;

  /** A free-form text: allowed within 24 hours of the person's last message. */
  abstract sendText(token: string, phoneNumberId: string, to: string, text: string): Promise<void>;
}
