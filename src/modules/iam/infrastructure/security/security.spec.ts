import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { newId } from '../../../../shared/domain/id.js';
import { InvalidAccessTokenError } from '../../application/errors.js';
import type { Principal } from '../../application/principal.js';
import { Argon2PasswordHasher } from './argon2-password-hasher.js';
import { CryptoOpaqueTokenService } from './crypto-opaque-token.service.js';
import { JwtAccessTokenService } from './jwt-access-token.service.js';

describe('Argon2PasswordHasher', () => {
  const policy = { memoryKib: 19_456, timeCost: 2, parallelism: 1 };
  const hasher = new Argon2PasswordHasher(policy);

  it('produces salted Argon2id hashes that verify', async () => {
    const first = await hasher.hash('correct horse battery');
    const second = await hasher.hash('correct horse battery');

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
    await expect(hasher.verify(first, 'correct horse battery')).resolves.toBe(true);
    await expect(hasher.verify(first, 'wrong password')).resolves.toBe(false);
  });

  it('treats malformed hashes as non-matching', async () => {
    await expect(hasher.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('asks for a rehash when the cost policy changes', async () => {
    const current = await hasher.hash('correct horse battery');
    const stronger = new Argon2PasswordHasher({ ...policy, timeCost: 3 });

    expect(hasher.needsRehash(current)).toBe(false);
    expect(stronger.needsRehash(current)).toBe(true);
    expect(hasher.needsRehash('garbage')).toBe(true);
  });
});

describe('JwtAccessTokenService', () => {
  const config = {
    secret: 's'.repeat(32),
    ttlSeconds: 900,
    issuer: 'ticbo-api',
    audience: 'ticbo-web',
  };
  const service = new JwtAccessTokenService(config);
  const principal: Principal = {
    userId: newId(),
    sessionId: newId(),
    accountId: newId(),
    role: 'owner',
  };

  it('round-trips the principal', async () => {
    const issued = await service.issue(principal);

    expect(issued.expiresInSeconds).toBe(900);
    await expect(service.verify(issued.token)).resolves.toEqual(principal);
  });

  it('rejects tokens signed with another secret', async () => {
    const forged = await new JwtAccessTokenService({ ...config, secret: 'x'.repeat(32) }).issue(
      principal,
    );

    await expect(service.verify(forged.token)).rejects.toThrow(InvalidAccessTokenError);
  });

  it('rejects tokens for another audience or issuer', async () => {
    const otherAudience = await new JwtAccessTokenService({ ...config, audience: 'other' }).issue(
      principal,
    );
    const otherIssuer = await new JwtAccessTokenService({ ...config, issuer: 'other' }).issue(
      principal,
    );

    await expect(service.verify(otherAudience.token)).rejects.toThrow(InvalidAccessTokenError);
    await expect(service.verify(otherIssuer.token)).rejects.toThrow(InvalidAccessTokenError);
  });

  it('rejects expired tokens', async () => {
    const expired = await new JwtService({ secret: config.secret }).signAsync(
      { sid: principal.sessionId, acc: null, role: null },
      {
        subject: principal.userId,
        issuer: config.issuer,
        audience: config.audience,
        expiresIn: -10,
      },
    );

    await expect(service.verify(expired)).rejects.toThrow(InvalidAccessTokenError);
  });

  it('rejects the "none" algorithm and garbage', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: principal.userId })).toString('base64url');

    await expect(service.verify(`${header}.${payload}.`)).rejects.toThrow(InvalidAccessTokenError);
    await expect(service.verify('garbage')).rejects.toThrow(InvalidAccessTokenError);
  });
});

describe('CryptoOpaqueTokenService', () => {
  const service = new CryptoOpaqueTokenService();

  it('generates unique 256-bit tokens with a matching SHA-256 hash', () => {
    const first = service.generate();
    const second = service.generate();

    expect(first.token).toMatch(/^[\w-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(service.hash(first.token)).toBe(first.hash);
  });
});
