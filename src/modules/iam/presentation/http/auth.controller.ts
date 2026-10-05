import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../../../shared/infrastructure/http/zod-validation.pipe.js';
import type { AuthSession } from '../../application/session-issuer.js';
import { LoginWithPasswordUseCase } from '../../application/use-cases/login-with-password.use-case.js';
import { LogoutUseCase } from '../../application/use-cases/logout.use-case.js';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case.js';
import { RegisterUserUseCase } from '../../application/use-cases/register-user.use-case.js';
import { AuthCookies } from './auth-cookies.js';
import { Public } from './auth.decorators.js';
import { type AuthSessionResponse, toAuthSessionResponse } from './auth.responses.js';
import {
  type LoginBody,
  loginBodySchema,
  type RegisterBody,
  registerBodySchema,
} from './auth.schemas.js';
import { clientContext } from './request-context.js';

const CREDENTIALS_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * The access token travels in the JSON body (the client keeps it in memory);
 * the refresh token only ever travels in an httpOnly cookie.
 */
@Public()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly loginWithPassword: LoginWithPasswordUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly logoutSession: LogoutUseCase,
    private readonly cookies: AuthCookies,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(CREDENTIALS_THROTTLE)
  async register(
    @Body(new ZodValidationPipe(registerBodySchema)) body: RegisterBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    const session = await this.registerUser.execute(body, clientContext(request));
    return this.respond(reply, session);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIALS_THROTTLE)
  async login(
    @Body(new ZodValidationPipe(loginBodySchema)) body: LoginBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    const session = await this.loginWithPassword.execute(body, clientContext(request));
    return this.respond(reply, session);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    try {
      const session = await this.refreshSession.execute(
        this.cookies.readRefreshToken(request),
        clientContext(request),
      );
      return this.respond(reply, session);
    } catch (error) {
      this.cookies.clearRefreshToken(reply);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.logoutSession.execute(this.cookies.readRefreshToken(request));
    this.cookies.clearRefreshToken(reply);
  }

  private respond(reply: FastifyReply, session: AuthSession): AuthSessionResponse {
    this.cookies.setRefreshToken(reply, session.refreshToken);
    void reply.header('cache-control', 'no-store');
    return toAuthSessionResponse(session);
  }
}
