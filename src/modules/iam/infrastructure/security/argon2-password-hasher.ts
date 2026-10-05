import { hash, parseOptions, verify } from '@node-rs/argon2';
import type { Argon2Config } from '../../../../config/app-config.js';
import type { PasswordHasher } from '../../application/ports/security.js';

// Value of Algorithm.Argon2id. The library exports it as an ambient const enum,
// which cannot be imported with isolatedModules.
const ARGON2ID = 2;

/**
 * Argon2id (RFC 9106), the OWASP-recommended password hash. Each hash gets its
 * own random 16-byte salt, embedded in the PHC string with the cost parameters.
 * Memory cost matters most: it makes GPU/ASIC cracking expensive.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  constructor(private readonly config: Argon2Config) {}

  hash(plain: string): Promise<string> {
    return hash(plain, {
      memoryCost: this.config.memoryKib,
      timeCost: this.config.timeCost,
      parallelism: this.config.parallelism,
    });
  }

  async verify(passwordHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plain);
    } catch {
      return false;
    }
  }

  needsRehash(passwordHash: string): boolean {
    try {
      const used = parseOptions(passwordHash);
      return (
        used.algorithm !== ARGON2ID ||
        used.memoryCost !== this.config.memoryKib ||
        used.timeCost !== this.config.timeCost ||
        used.parallelism !== this.config.parallelism
      );
    } catch {
      return true;
    }
  }
}
