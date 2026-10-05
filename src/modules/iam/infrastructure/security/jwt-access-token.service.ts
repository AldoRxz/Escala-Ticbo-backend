import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import type { AccessTokenConfig } from '../../../../config/app-config.js';
import { InvalidAccessTokenError } from '../../application/errors.js';
import type { Principal } from '../../application/principal.js';
import type { AccessTokenService, IssuedAccessToken } from '../../application/ports/security.js';
import { MEMBER_ROLES } from '../../domain/user.js';

const claimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  acc: z.uuid().nullable(),
  role: z.enum(MEMBER_ROLES).nullable(),
});

/**
 * HS256 access tokens: verified locally on every request with no database
 * lookup. They live minutes; revocation happens on the refresh token.
 */
export class JwtAccessTokenService implements AccessTokenService {
  private readonly jwt: JwtService;

  constructor(private readonly config: AccessTokenConfig) {
    this.jwt = new JwtService({ secret: config.secret });
  }

  async issue(principal: Principal): Promise<IssuedAccessToken> {
    const token = await this.jwt.signAsync(
      { sid: principal.sessionId, acc: principal.accountId, role: principal.role },
      {
        subject: principal.userId,
        expiresIn: this.config.ttlSeconds,
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithm: 'HS256',
      },
    );
    return { token, expiresInSeconds: this.config.ttlSeconds };
  }

  async verify(token: string): Promise<Principal> {
    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(token, {
        algorithms: ['HS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
    } catch {
      throw new InvalidAccessTokenError();
    }

    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new InvalidAccessTokenError();
    }
    return {
      userId: claims.data.sub,
      sessionId: claims.data.sid,
      accountId: claims.data.acc,
      role: claims.data.role,
    };
  }
}
