import { AppError } from '../../../shared/domain/app-error.js';

export class InvalidCredentialsError extends AppError {
  override readonly code = 'invalid_credentials';
  override readonly category = 'unauthenticated';

  constructor() {
    super('Email or password is incorrect.');
  }
}

export class InvalidRefreshTokenError extends AppError {
  override readonly code = 'invalid_refresh_token';
  override readonly category = 'unauthenticated';

  constructor() {
    super('The session is no longer valid. Sign in again.');
  }
}

export class InvalidAccessTokenError extends AppError {
  override readonly code = 'invalid_access_token';
  override readonly category = 'unauthenticated';

  constructor() {
    super('The access token is invalid or has expired.');
  }
}

export class AuthenticationRequiredError extends AppError {
  override readonly code = 'authentication_required';
  override readonly category = 'unauthenticated';

  constructor() {
    super('Send a Bearer access token in the Authorization header.');
  }
}

export class OAuthProviderNotEnabledError extends AppError {
  override readonly code = 'oauth_provider_not_enabled';
  override readonly category = 'not_found';

  constructor(provider: string) {
    super(`Sign-in with "${provider}" is not enabled.`);
  }
}

export class OAuthEmailNotVerifiedError extends AppError {
  override readonly code = 'oauth_email_not_verified';
  override readonly category = 'forbidden';

  constructor() {
    super('The provider did not confirm that the email address is verified.');
  }
}

export class OAuthExchangeFailedError extends AppError {
  override readonly code = 'oauth_exchange_failed';
  override readonly category = 'unavailable';

  constructor(reason: string, options?: ErrorOptions) {
    super(`The sign-in provider could not be reached or answered unexpectedly (${reason}).`, options);
  }
}
