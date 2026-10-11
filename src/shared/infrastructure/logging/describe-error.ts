/**
 * Text for logging an unexpected error: stack plus every `cause` (Drizzle wraps
 * driver errors, so without the chain a log says "Failed query" and hides the
 * real reason), with SQL parameters redacted. Drizzle puts the bound values in
 * the message, and those are emails, names and password hashes.
 */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    const text =
      current instanceof Error
        ? (current.stack ?? current.message)
        : typeof current === 'string'
          ? current
          : JSON.stringify(current);
    parts.push(depth === 0 ? redactSqlParameters(text) : `Caused by: ${redactSqlParameters(text)}`);
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join('\n');
}

function redactSqlParameters(text: string): string {
  return text.replace(/(\n\s*params:)[^\n]*/g, '$1 [redacted]');
}
