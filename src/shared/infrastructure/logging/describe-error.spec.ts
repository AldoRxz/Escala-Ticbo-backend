import { describe, expect, it } from 'vitest';
import { describeError } from './describe-error.js';

describe('describeError', () => {
  it('keeps the cause chain and redacts SQL parameters', () => {
    const driverError = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const queryError = new Error(
      'Failed query: insert into "users" ("email", "password_hash") values ($1, $2)\nparams: ana@example.com,$argon2id$v=19$m=19456',
      { cause: driverError },
    );

    const text = describeError(queryError);

    expect(text).toContain('insert into "users"');
    expect(text).toContain('Caused by: Error: connect ECONNREFUSED');
    expect(text).toContain('params: [redacted]');
    expect(text).not.toContain('ana@example.com');
    expect(text).not.toContain('argon2id');
  });

  it('describes values that are not errors', () => {
    expect(describeError('boom')).toBe('boom');
    expect(describeError({ code: 'X' })).toBe('{"code":"X"}');
  });
});
