import { createHash, randomBytes } from 'node:crypto';
import type { OpaqueTokenService } from '../../application/ports/security.js';

/**
 * 256-bit random tokens. A plain SHA-256 is enough to store them: unlike
 * passwords they have full entropy, so there is nothing to brute-force.
 */
export class CryptoOpaqueTokenService implements OpaqueTokenService {
  generate(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
