import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { GoogleOAuthConfig } from '../../../../config/app-config.js';
import type { Clock } from '../../../../shared/application/clock.js';
import { OAuthExchangeFailedError } from '../../application/errors.js';
import type {
  OAuthAuthorizationRequest,
  OAuthCallback,
  OAuthProvider,
} from '../../application/ports/oauth-provider.js';
import type { OAuthProfile } from '../../domain/oauth.js';
import { FULL_NAME_MAX_LENGTH } from '../../domain/user.js';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const CLOCK_SKEW_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 10_000;

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

const idTokenClaimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().min(1).max(255),
  exp: z.number(),
  nonce: z.string().optional(),
  email: z.email(),
  email_verified: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
    .optional(),
  name: z.string().optional(),
  picture: z.url().optional(),
});

/**
 * Google sign-in: OpenID Connect authorization-code flow with PKCE (S256), a
 * state value against CSRF and a nonce against ID-token replay. Stateless: the
 * controller keeps state, verifier and nonce in a short-lived signed cookie.
 */
export class GoogleOAuthProvider implements OAuthProvider {
  readonly name = 'google' as const;

  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly clock: Clock,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  createAuthorizationRequest(): OAuthAuthorizationRequest {
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();

    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();

    return { url: url.toString(), state, codeVerifier, nonce };
  }

  async exchangeCode({ code, codeVerifier, nonce }: OAuthCallback): Promise<OAuthProfile> {
    const idToken = await this.requestIdToken(code, codeVerifier);

    // OpenID Connect Core 3.1.3.7: this ID token came straight from Google's token
    // endpoint over TLS, which authenticates the issuer, so the signature check may
    // be skipped. Every claim that binds the token to this sign-in is still checked.
    const parsed = idTokenClaimsSchema.safeParse(decodeJwtPayload(idToken));
    if (!parsed.success) {
      throw new OAuthExchangeFailedError('malformed ID token');
    }
    const claims = parsed.data;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);

    if (
      !ISSUERS.has(claims.iss) ||
      !audiences.includes(this.config.clientId) ||
      claims.exp + CLOCK_SKEW_SECONDS < nowSeconds ||
      claims.nonce !== nonce
    ) {
      throw new OAuthExchangeFailedError('ID token failed validation');
    }

    return {
      provider: 'google',
      subject: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified === true,
      fullName: (claims.name?.trim() || claims.email).slice(0, FULL_NAME_MAX_LENGTH),
      avatarUrl: claims.picture ?? null,
    };
  }

  private async requestIdToken(code: string, codeVerifier: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchFn(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          redirect_uri: this.config.redirectUri,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new OAuthExchangeFailedError('token endpoint unreachable', { cause: error });
    }

    if (!response.ok) {
      throw new OAuthExchangeFailedError(`token endpoint answered ${response.status}`);
    }
    const body = tokenResponseSchema.safeParse(await response.json().catch(() => null));
    if (!body.success) {
      throw new OAuthExchangeFailedError('token response without id_token');
    }
    return body.data.id_token;
  }
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function decodeJwtPayload(jwt: string): unknown {
  const payload = jwt.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
