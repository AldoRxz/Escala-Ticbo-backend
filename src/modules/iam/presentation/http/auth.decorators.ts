import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthenticationRequiredError } from '../../application/errors.js';
import type { Principal } from '../../application/principal.js';

export const IS_PUBLIC_ROUTE = 'iam:public-route';

/** Opts a controller or handler out of the global bearer-token guard. */
export const Public = () => SetMetadata(IS_PUBLIC_ROUTE, true);

/** Injects the authenticated caller verified by JwtAuthGuard. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.principal) {
      throw new AuthenticationRequiredError();
    }
    return request.principal;
  },
);
