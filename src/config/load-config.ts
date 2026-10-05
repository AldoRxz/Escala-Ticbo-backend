import { z } from 'zod';
import { API_BASE_PATH } from '../shared/infrastructure/http/api-path.js';
import type { AppConfig } from './app-config.js';

const httpUrl = z.url({ protocol: /^https?$/ });
const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const secret = z.string().min(32, 'must be a random value of at least 32 characters');
const commaSeparated = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_VERSION: z.string().default('dev'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY: booleanString.default(false),
    API_PUBLIC_URL: httpUrl,
    WEB_APP_URL: httpUrl,
    CORS_ORIGINS: commaSeparated.pipe(z.array(httpUrl).min(1)),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: booleanString.default(false),
    JWT_ACCESS_SECRET: secret,
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    JWT_ISSUER: z.string().min(1).default('ticbo-api'),
    JWT_AUDIENCE: z.string().min(1).default('ticbo-web'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
    COOKIE_SECRET: secret,
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).max(1_048_576).default(19_456),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).max(10).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(8).default(1),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
      });
    }
    if (env.NODE_ENV === 'production' && !env.API_PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_PUBLIC_URL'],
        message: 'must use https in production',
      });
    }
  });

/**
 * Parses and validates environment variables. Fails fast with every problem
 * listed at once; values are never echoed, so secrets do not reach the logs.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  // Empty assignments in .env files (`KEY=`) mean "not set".
  const input = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  const env = parsed.data;
  const apiPublicUrl = env.API_PUBLIC_URL.replace(/\/+$/, '');

  return {
    env: env.NODE_ENV,
    version: env.APP_VERSION,
    logLevel: env.LOG_LEVEL,
    http: {
      host: env.HOST,
      port: env.PORT,
      trustProxy: env.TRUST_PROXY,
      apiPublicUrl,
      webAppUrl: env.WEB_APP_URL.replace(/\/+$/, ''),
      corsOrigins: env.CORS_ORIGINS,
    },
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
      ssl: env.DATABASE_SSL,
    },
    auth: {
      accessToken: {
        secret: env.JWT_ACCESS_SECRET,
        ttlSeconds: env.JWT_ACCESS_TTL_SECONDS,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      },
      refreshToken: {
        ttlDays: env.REFRESH_TOKEN_TTL_DAYS,
        reuseGraceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
      },
      cookieSecret: env.COOKIE_SECRET,
      cookieSecure: apiPublicUrl.startsWith('https://'),
      argon2: {
        memoryKib: env.ARGON2_MEMORY_KIB,
        timeCost: env.ARGON2_TIME_COST,
        parallelism: env.ARGON2_PARALLELISM,
      },
      google:
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              redirectUri: `${apiPublicUrl}${API_BASE_PATH}/auth/oauth/google/callback`,
            }
          : null,
    },
  };
}
