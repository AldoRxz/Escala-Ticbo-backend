import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { InvalidInputError, type ValidationIssue } from '../../domain/app-error.js';

export type { ValidationIssue };

export class RequestValidationError extends InvalidInputError {}

/**
 * Validates and parses a request part (body, query, params) with a Zod schema.
 * A custom issue may carry its own stable code in `params.code`.
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    throw new RequestValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
        code: customCode(issue) ?? issue.code,
      })),
    );
  }
}

function customCode(issue: z.core.$ZodIssue): string | undefined {
  if (issue.code !== 'custom') {
    return undefined;
  }
  const code = (issue.params as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}
