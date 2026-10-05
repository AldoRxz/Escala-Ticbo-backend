import { randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { ConsoleLogger, type LogLevel as NestLogLevel, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { AppModule } from '../app.module.js';
import type { AppConfig, LogLevel } from '../config/app-config.js';
import { API_DEFAULT_VERSION, API_PREFIX } from '../shared/infrastructure/http/api-path.js';

const NEST_LOG_LEVELS: Record<LogLevel, NestLogLevel[]> = {
  silent: [],
  fatal: ['fatal'],
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  trace: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

/** Builds the fully configured application. Shared by main.ts and the e2e tests. */
export async function createApp(config: AppConfig): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: config.http.trustProxy,
    bodyLimit: 1_048_576,
    genReqId: () => randomUUID(),
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            serializers: {
              // Path only: query strings can carry OAuth codes and other one-time values.
              req: (request: FastifyRequest) => ({
                method: request.method,
                path: request.url.split('?')[0],
                ip: request.ip,
              }),
            },
          },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config),
    adapter,
    {
      logger: new ConsoleLogger({
        json: config.env === 'production',
        logLevels: NEST_LOG_LEVELS[config.logLevel],
      }),
    },
  );

  await app.register(fastifyCookie, { secret: config.auth.cookieSecret });
  await app.register(fastifyHelmet);
  app.enableCors({
    origin: config.http.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_DEFAULT_VERSION });
  app.enableShutdownHooks();

  return app;
}
