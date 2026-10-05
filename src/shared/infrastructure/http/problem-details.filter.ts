import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, type ErrorCategory } from '../../domain/app-error.js';
import { RequestValidationError, type ValidationIssue } from './zod-validation.pipe.js';

/** RFC 9457 problem details, plus a stable `code` clients can branch on. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance?: string;
  requestId?: string;
  errors?: ValidationIssue[];
}

const STATUS_BY_CATEGORY: Record<ErrorCategory, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
};

const CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'too_many_requests',
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const path = request.url.split('?')[0];
    const problem = this.toProblem(exception);

    if (problem.status >= 500) {
      this.logger.error(
        `${request.method} ${path} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    if (problem.status === 401) {
      void reply.header('www-authenticate', 'Bearer');
    }

    void reply
      .status(problem.status)
      .type('application/problem+json')
      .send({ ...problem, instance: path, requestId: String(request.id) });
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof AppError) {
      const status = STATUS_BY_CATEGORY[exception.category];
      return {
        ...base(status),
        code: exception.code,
        detail: exception.message,
        ...(exception instanceof RequestValidationError ? { errors: exception.issues } : {}),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { ...base(status), code: codeFor(status), detail: httpExceptionDetail(exception) };
    }

    // Errors raised by Fastify itself (malformed JSON, unsupported content type...).
    const status = clientErrorStatus(exception);
    if (status !== null) {
      return { ...base(status), code: codeFor(status), detail: (exception as Error).message };
    }

    return { ...base(500), code: 'internal_error', detail: 'An unexpected error occurred.' };
  }
}

function base(status: number): Pick<ProblemDetails, 'type' | 'title' | 'status'> {
  return { type: 'about:blank', title: STATUS_CODES[status] ?? 'Error', status };
}

function codeFor(status: number): string {
  return CODE_BY_STATUS[status] ?? (status >= 500 ? 'internal_error' : 'bad_request');
}

function httpExceptionDetail(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) {
    return message.map(String).join('; ');
  }
  return typeof message === 'string' ? message : exception.message;
}

function clientErrorStatus(exception: unknown): number | null {
  if (!(exception instanceof Error)) {
    return null;
  }
  const statusCode = (exception as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : null;
}
