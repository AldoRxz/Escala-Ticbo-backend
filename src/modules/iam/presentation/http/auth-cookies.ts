import { Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppConfig } from '../../../../config/app-config.js';
import { API_BASE_PATH } from '../../../../shared/infrastructure/http/api-path.js';

const REFRESH_COOKIE = 'ticbo_rt';
// Sent only to the auth endpoints, never to the rest of the API.
const REFRESH_COOKIE_PATH = `${API_BASE_PATH}/auth`;
const OAUTH_COOKIE = 'ticbo_oauth';
const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

const oauthStateSchema = z.object({
  state: z.string(),
  codeVerifier: z.string(),
  nonce: z.string(),
});
export type OAuthStateCookie = z.infer<typeof oauthStateSchema>;

/**
 * Refresh token: httpOnly (unreadable from JavaScript), SameSite=Strict (never
 * sent on cross-site requests, which also rules out CSRF on /auth/refresh).
 *
 * OAuth state: signed, 10 minutes, SameSite=Lax because the provider's callback
 * arrives as a cross-site top-level navigation.
 */
@Injectable()
export class AuthCookies {
  private readonly secure: boolean;

  constructor(config: AppConfig) {
    this.secure = config.auth.cookieSecure;
  }

  readRefreshToken(request: FastifyRequest): string | undefined {
    return request.cookies[REFRESH_COOKIE];
  }

  setRefreshToken(reply: FastifyReply, token: { value: string; expiresAt: Date }): void {
    reply.setCookie(REFRESH_COOKIE, token.value, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      expires: token.expiresAt,
    });
  }

  clearRefreshToken(reply: FastifyReply): void {
    reply.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    });
  }

  setOAuthState(reply: FastifyReply, provider: string, value: OAuthStateCookie): void {
    reply.setCookie(OAUTH_COOKIE, Buffer.from(JSON.stringify(value)).toString('base64url'), {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: oauthCookiePath(provider),
      maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
      signed: true,
    });
  }

  /** Returns null when the cookie is missing, expired, tampered with or malformed. */
  readOAuthState(request: FastifyRequest): OAuthStateCookie | null {
    const raw = request.cookies[OAUTH_COOKIE];
    if (!raw) {
      return null;
    }
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || unsigned.value === null) {
      return null;
    }
    try {
      const decoded: unknown = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8'));
      const parsed = oauthStateSchema.safeParse(decoded);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  clearOAuthState(reply: FastifyReply, provider: string): void {
    reply.clearCookie(OAUTH_COOKIE, { path: oauthCookiePath(provider) });
  }
}

function oauthCookiePath(provider: string): string {
  return `${API_BASE_PATH}/auth/oauth/${provider}`;
}
