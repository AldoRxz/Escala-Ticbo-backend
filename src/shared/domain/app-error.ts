/**
 * What kind of failure an error represents. The HTTP layer maps each category to
 * a status code; the domain and application layers never deal with HTTP.
 */
export type ErrorCategory =
  | 'invalid_input'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unavailable';

/** Base class for expected failures. Anything else is treated as a bug (500). */
export abstract class AppError extends Error {
  /** Stable, machine-readable identifier that clients can branch on. */
  abstract readonly code: string;
  abstract readonly category: ErrorCategory;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** One problem with one field; `code` is stable so clients can show their own message. */
export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

/** Input that breaks one or more rules, reported field by field. */
export class InvalidInputError extends AppError {
  override readonly code: string = 'validation_failed';
  override readonly category = 'invalid_input';

  constructor(readonly issues: ValidationIssue[]) {
    super('The request is invalid.');
  }
}
