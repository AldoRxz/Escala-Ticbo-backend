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
  /** CA certificate (PEM) to verify the server with; null uses the system CAs. */
  sslCa: string | null;
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

export interface VaultConfig {
  /** Key-encryption keys; the first one wraps new secrets, all of them can unwrap. */
  keys: Array<{ id: string; key: Buffer }>;
}

export interface InvoiceMailboxConfig {
  /** Ticbo's invoice inbox; each fiscal profile gets a plus-address alias of it. */
  address: string;
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
  abstract readonly vault: VaultConfig;
  abstract readonly invoiceMailbox: InvoiceMailboxConfig;
}
