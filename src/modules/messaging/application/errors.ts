import { AppError } from '../../../shared/domain/app-error.js';

export class WhatsAppChannelNotFoundError extends AppError {
  override readonly code = 'whatsapp_channel_not_found';
  override readonly category = 'not_found';

  constructor() {
    super('The WhatsApp number is not connected to this account.');
  }
}

export class WhatsAppNumberAlreadyConnectedError extends AppError {
  override readonly code = 'whatsapp_number_already_connected';
  override readonly category = 'conflict';

  constructor() {
    super('This WhatsApp number is already connected to Ticbo.');
  }
}

export class WhatsAppSenderNotFoundError extends AppError {
  override readonly code = 'whatsapp_sender_not_found';
  override readonly category = 'not_found';

  constructor() {
    super('The phone is not authorized on this number.');
  }
}

export class WhatsAppSenderAlreadyAuthorizedError extends AppError {
  override readonly code = 'whatsapp_sender_already_authorized';
  override readonly category = 'conflict';

  constructor() {
    super('This phone is already authorized on this number.');
  }
}

export class WebhookVerificationFailedError extends AppError {
  override readonly code = 'webhook_verification_failed';
  override readonly category = 'forbidden';

  constructor() {
    super('The verify token does not match.');
  }
}

export class TelegramBotNotFoundError extends AppError {
  override readonly code = 'telegram_bot_not_found';
  override readonly category = 'not_found';

  constructor() {
    super('The Telegram bot is not connected to this account.');
  }
}

export class TelegramBotAlreadyConnectedError extends AppError {
  override readonly code = 'telegram_bot_already_connected';
  override readonly category = 'conflict';

  constructor() {
    super('This Telegram bot is already connected to Ticbo.');
  }
}

export class TelegramSenderNotFoundError extends AppError {
  override readonly code = 'telegram_sender_not_found';
  override readonly category = 'not_found';

  constructor() {
    super('The phone is not authorized on this bot.');
  }
}

export class TelegramSenderAlreadyAuthorizedError extends AppError {
  override readonly code = 'telegram_sender_already_authorized';
  override readonly category = 'conflict';

  constructor() {
    super('This phone is already authorized on this bot.');
  }
}

export class TelegramUnavailableError extends AppError {
  override readonly code = 'telegram_unavailable';
  override readonly category = 'unavailable';

  constructor(options?: ErrorOptions) {
    super('Telegram did not answer. Try again in a few minutes.', options);
  }
}
