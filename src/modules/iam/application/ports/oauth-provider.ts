import type { OAuthProfile, OAuthProviderName } from '../../domain/oauth.js';
import { OAuthProviderNotEnabledError } from '../errors.js';

export interface OAuthAuthorizationRequest {
  /** Provider URL the browser is redirected to. */
  url: string;
  state: string;
  /** PKCE code verifier; only its S256 challenge travels in the URL. */
  codeVerifier: string;
  nonce: string;
}

export interface OAuthCallback {
  code: string;
  codeVerifier: string;
  nonce: string;
}

/**
 * Authorization-code flow with PKCE against one provider. Each provider (Google,
 * Facebook...) is an adapter of this port.
 */
export abstract class OAuthProvider {
  abstract readonly name: OAuthProviderName;
  abstract createAuthorizationRequest(): OAuthAuthorizationRequest;
  /** @throws OAuthExchangeFailedError */
  abstract exchangeCode(callback: OAuthCallback): Promise<OAuthProfile>;
}

/** Providers enabled by configuration, looked up by the name in the route. */
export class OAuthProviderRegistry {
  private readonly providers: ReadonlyMap<string, OAuthProvider>;

  constructor(providers: OAuthProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
  }

  /** @throws OAuthProviderNotEnabledError */
  get(name: string): OAuthProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new OAuthProviderNotEnabledError(name);
    }
    return provider;
  }
}
