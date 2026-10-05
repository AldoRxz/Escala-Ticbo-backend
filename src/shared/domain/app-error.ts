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
