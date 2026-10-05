import { AppError } from '../../../shared/domain/app-error.js';

export class InvalidEmailError extends AppError {
  override readonly code = 'invalid_email';
  override readonly category = 'invalid_input';

  constructor() {
    super('The email address is not valid.');
  }
}

export class WeakPasswordError extends AppError {
  override readonly code = 'weak_password';
  override readonly category = 'invalid_input';

  constructor(minLength: number, maxLength: number) {
    super(`Passwords must be between ${minLength} and ${maxLength} characters long.`);
  }
}

export class EmailAlreadyRegisteredError extends AppError {
  override readonly code = 'email_already_registered';
  override readonly category = 'conflict';

  constructor() {
    super('An account with this email already exists.');
  }
}
