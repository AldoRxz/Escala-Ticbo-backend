import type { FastifyRequest } from 'fastify';
import type { ClientContext, Principal } from '../../application/principal.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by JwtAuthGuard once the bearer token is verified. */
    principal?: Principal;
  }
}

export function clientContext(request: FastifyRequest): ClientContext {
  const userAgent = request.headers['user-agent'];
  return {
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
    ipAddress: request.ip ? request.ip.slice(0, 45) : null,
  };
}
