export type Environment = 'development' | 'test' | 'production';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface HttpConfig {
  host: string;
  port: number;
  /** Trust X-Forwarded-* headers (behind Cloudflare or a load balancer). */
  trustProxy: boolean;
  /** Public base URL of this API, without trailing slash. */
  apiPublicUrl: string;
  /** Base URL of the web app, used for OAuth redirects. */
  webAppUrl: string;
  corsOrigins: string[];
}

export interface DatabaseConfig {
  url: string;
  poolMax: number;
  ssl: boolean;
}

export interface AccessTokenConfig {
  secret: string;
  ttlSeconds: number;
  issuer: string;
  audience: string;
}

export interface RefreshTokenConfig {
  ttlDays: number;
  /** Window in which a just-rotated token is rejected without revoking its family (parallel tabs). */
  reuseGraceSeconds: number;
}

export interface Argon2Config {
  memoryKib: number;
  timeCost: number;
  parallelism: number;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AuthConfig {
  accessToken: AccessTokenConfig;
  refreshToken: RefreshTokenConfig;
  cookieSecret: string;
  /** Mark cookies Secure; true whenever the API is served over https. */
  cookieSecure: boolean;
  argon2: Argon2Config;
  google: GoogleOAuthConfig | null;
}

/**
 * Validated runtime configuration. Declared as an abstract class so Nest can
 * inject it by type; the value is a plain object built by `loadConfig`.
 */
export abstract class AppConfig {
  abstract readonly env: Environment;
  abstract readonly version: string;
  abstract readonly logLevel: LogLevel;
  abstract readonly http: HttpConfig;
  abstract readonly database: DatabaseConfig;
  abstract readonly auth: AuthConfig;
}
