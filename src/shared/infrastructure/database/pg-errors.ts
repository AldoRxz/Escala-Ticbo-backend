const UNIQUE_VIOLATION = '23505';

/**
 * True when `error` is a PostgreSQL unique violation (optionally on `constraint`).
 * Drizzle wraps driver errors, so the `cause` chain is inspected too.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === UNIQUE_VIOLATION) {
      return constraint === undefined || candidate.constraint === constraint;
    }
    current = candidate.cause;
  }
  return false;
}
