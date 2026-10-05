import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { AppConfig } from './config/app-config.js';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IamModule } from './modules/iam/iam.module.js';
import { JwtAuthGuard } from './modules/iam/presentation/http/jwt-auth.guard.js';
import { DatabaseModule } from './shared/infrastructure/database/database.module.js';
import { ProblemDetailsFilter } from './shared/infrastructure/http/problem-details.filter.js';
import { SharedModule } from './shared/shared.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        SharedModule,
        DatabaseModule,
        // In-memory counters per instance. Move to a shared store before running
        // more than one API instance behind the load balancer.
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
          skipIf: () => config.env === 'test',
        }),
        HealthModule,
        IamModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        // Guards run in this order: rate limit first, then authentication.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    };
  }
}
