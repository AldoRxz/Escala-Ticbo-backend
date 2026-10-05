import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuthenticationRequiredError } from '../../application/errors.js';
import { AccessTokenService } from '../../application/ports/security.js';
import { IS_PUBLIC_ROUTE } from './auth.decorators.js';

/**
 * Registered globally: every route requires `Authorization: Bearer <token>`
 * unless it is marked with @Public(). Secure by default.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      throw new AuthenticationRequiredError();
    }
    request.principal = await this.accessTokens.verify(token);
    return true;
  }
}

function bearerToken(header: string | undefined): string | null {
  const [scheme, token, ...rest] = header?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' && token && rest.length === 0 ? token : null;
}
