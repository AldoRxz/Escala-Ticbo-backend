import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { Clock } from '../../shared/application/clock.js';
import { OAuthProviderRegistry } from './application/ports/oauth-provider.js';
import {
  AccessTokenService,
  OpaqueTokenService,
  PasswordHasher,
} from './application/ports/security.js';
import { SessionRepository } from './application/ports/session.repository.js';
import { UserRepository } from './application/ports/user.repository.js';
import { SessionIssuer, SessionSettings } from './application/session-issuer.js';
import { GetCurrentUserUseCase } from './application/use-cases/get-current-user.use-case.js';
import { LoginWithOAuthUseCase } from './application/use-cases/login-with-oauth.use-case.js';
import { LoginWithPasswordUseCase } from './application/use-cases/login-with-password.use-case.js';
import { LogoutUseCase } from './application/use-cases/logout.use-case.js';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case.js';
import { RegisterUserUseCase } from './application/use-cases/register-user.use-case.js';
import { GoogleOAuthProvider } from './infrastructure/oauth/google-oauth.provider.js';
import { DrizzleSessionRepository } from './infrastructure/persistence/drizzle-session.repository.js';
import { DrizzleUserRepository } from './infrastructure/persistence/drizzle-user.repository.js';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher.js';
import { CryptoOpaqueTokenService } from './infrastructure/security/crypto-opaque-token.service.js';
import { JwtAccessTokenService } from './infrastructure/security/jwt-access-token.service.js';
import { AuthCookies } from './presentation/http/auth-cookies.js';
import { AuthController } from './presentation/http/auth.controller.js';
import { MeController } from './presentation/http/me.controller.js';
import { OAuthController } from './presentation/http/oauth.controller.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Identity & access: users, sign-in, sessions and tenant memberships. */
@Module({
  controllers: [AuthController, OAuthController, MeController],
  providers: [
    // Ports → adapters
    { provide: UserRepository, useClass: DrizzleUserRepository },
    { provide: SessionRepository, useClass: DrizzleSessionRepository },
    { provide: OpaqueTokenService, useClass: CryptoOpaqueTokenService },
    {
      provide: PasswordHasher,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new Argon2PasswordHasher(config.auth.argon2),
    },
    {
      provide: AccessTokenService,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new JwtAccessTokenService(config.auth.accessToken),
    },
    {
      provide: OAuthProviderRegistry,
      inject: [AppConfig, Clock],
      useFactory: (config: AppConfig, clock: Clock) =>
        new OAuthProviderRegistry(
          config.auth.google ? [new GoogleOAuthProvider(config.auth.google, clock)] : [],
        ),
    },
    {
      provide: SessionSettings,
      inject: [AppConfig],
      useFactory: (config: AppConfig): SessionSettings => ({
        refreshTokenTtlMs: config.auth.refreshToken.ttlDays * DAY_MS,
        reuseGraceMs: config.auth.refreshToken.reuseGraceSeconds * 1000,
      }),
    },
    // Application
    SessionIssuer,
    RegisterUserUseCase,
    LoginWithPasswordUseCase,
    LoginWithOAuthUseCase,
    RefreshSessionUseCase,
    LogoutUseCase,
    GetCurrentUserUseCase,
    // Presentation
    AuthCookies,
  ],
  exports: [AccessTokenService],
})
export class IamModule {}
