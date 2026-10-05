import type { Principal } from '../principal.js';

export abstract class PasswordHasher {
  abstract hash(plain: string): Promise<string>;
  /** Never throws: a malformed hash simply does not verify. */
  abstract verify(passwordHash: string, plain: string): Promise<boolean>;
  /** True when the hash was produced with parameters other than the current policy. */
  abstract needsRehash(passwordHash: string): boolean;
}

export interface IssuedAccessToken {
  token: string;
  expiresInSeconds: number;
}

/** Short-lived, stateless bearer tokens. */
export abstract class AccessTokenService {
  abstract issue(principal: Principal): Promise<IssuedAccessToken>;
  /** @throws InvalidAccessTokenError */
  abstract verify(token: string): Promise<Principal>;
}

/** Random, unguessable tokens that are stored only as hashes (refresh tokens). */
export abstract class OpaqueTokenService {
  abstract generate(): { token: string; hash: string };
  abstract hash(token: string): string;
}
