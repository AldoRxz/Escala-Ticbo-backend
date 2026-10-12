const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
// PostgreSQL 18 reports ON DELETE RESTRICT with its own code instead of 23503.
const RESTRICT_VIOLATION = '23001';

/**
 * True when `error` is a PostgreSQL unique violation (optionally on `constraint`).
 * Drizzle wraps driver errors, so the `cause` chain is inspected too.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  return hasSqlState(error, UNIQUE_VIOLATION, constraint);
}

/** True when `error` is a foreign key violation, e.g. deleting a row other rows still reference. */
export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  return (
    hasSqlState(error, FOREIGN_KEY_VIOLATION, constraint) ||
    hasSqlState(error, RESTRICT_VIOLATION, constraint)
  );
}

function hasSqlState(error: unknown, sqlState: string, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === sqlState) {
      return constraint === undefined || candidate.constraint === constraint;
    }
    current = candidate.cause;
  }
  return false;
}
