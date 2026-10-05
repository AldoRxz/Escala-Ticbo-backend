import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Logger, Param, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppConfig } from '../../../../config/app-config.js';
import { AppError } from '../../../../shared/domain/app-error.js';
import {
  type OAuthProvider,
  OAuthProviderRegistry,
} from '../../application/ports/oauth-provider.js';
import { LoginWithOAuthUseCase } from '../../application/use-cases/login-with-oauth.use-case.js';
import { AuthCookies } from './auth-cookies.js';
import { Public } from './auth.decorators.js';
import { oauthCallbackQuerySchema } from './auth.schemas.js';
import { clientContext } from './request-context.js';

/**
 * Browser-facing OAuth endpoints. Both answer with redirects: the callback sends
 * the user back to the web app with the refresh cookie set (never a token in the
 * URL); the app then calls POST /auth/refresh to obtain its access token.
 */
@Public()
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('auth/oauth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);
  private readonly webAppUrl: string;

  constructor(
    private readonly providers: OAuthProviderRegistry,
    private readonly loginWithOAuth: LoginWithOAuthUseCase,
    private readonly cookies: AuthCookies,
    config: AppConfig,
  ) {
    this.webAppUrl = config.http.webAppUrl;
  }

  @Get(':provider')
  start(@Param('provider') providerName: string, @Res() reply: FastifyReply): void {
    const provider = this.providers.get(providerName);
    const request = provider.createAuthorizationRequest();
    this.cookies.setOAuthState(reply, provider.name, {
      state: request.state,
      codeVerifier: request.codeVerifier,
      nonce: request.nonce,
    });
    void reply.header('cache-control', 'no-store').redirect(request.url, 302);
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') providerName: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const provider = this.providers.get(providerName);
    const destination = await this.completeSignIn(provider, query, request, reply);
    this.cookies.clearOAuthState(reply, provider.name);
    void reply.header('cache-control', 'no-store').redirect(destination, 302);
  }

  /** Returns where to send the browser: the app on success, its login page on failure. */
  private async completeSignIn(
    provider: OAuthProvider,
    query: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string> {
    const params = oauthCallbackQuerySchema.safeParse(query);
    if (!params.success) {
      return this.failure('oauth_failed');
    }
    if (params.data.error) {
      return this.failure(params.data.error === 'access_denied' ? 'oauth_denied' : 'oauth_failed');
    }

    const stored = this.cookies.readOAuthState(request);
    const { code, state } = params.data;
    if (!stored || !code || !state || !sameString(state, stored.state)) {
      return this.failure('oauth_state_mismatch');
    }

    try {
      const profile = await provider.exchangeCode({
        code,
        codeVerifier: stored.codeVerifier,
        nonce: stored.nonce,
      });
      const session = await this.loginWithOAuth.execute(profile, clientContext(request));
      this.cookies.setRefreshToken(reply, session.refreshToken);
      return `${this.webAppUrl}/auth/callback`;
    } catch (error) {
      if (error instanceof AppError) {
        this.logger.warn(`Sign-in with ${provider.name} failed: ${error.code}`);
        return this.failure(error.code);
      }
      this.logger.error(
        `Sign-in with ${provider.name} failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return this.failure('oauth_failed');
    }
  }

  private failure(code: string): string {
    const url = new URL('/login', this.webAppUrl);
    url.searchParams.set('error', code);
    return url.toString();
  }
}

function sameString(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
