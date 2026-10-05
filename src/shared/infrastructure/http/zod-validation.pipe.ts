import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../domain/app-error.js';

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

export class RequestValidationError extends AppError {
  override readonly code = 'validation_failed';
  override readonly category = 'invalid_input';

  constructor(readonly issues: ValidationIssue[]) {
    super('The request is invalid.');
  }
}

/** Validates and parses a request part (body, query, params) with a Zod schema. */
export class ZodValidationPipe<TSchema extends z.ZodType>
  implements PipeTransform<unknown, z.output<TSchema>>
{
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
        code: issue.code,
      })),
    );
  }
}
