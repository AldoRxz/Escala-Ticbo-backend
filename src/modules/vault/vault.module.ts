import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { EnvelopeCipher, SecretRepository } from './application/ports.js';
import { SecretVault } from './application/secret-vault.js';
import { AesGcmEnvelopeCipher } from './infrastructure/aes-gcm-envelope.cipher.js';
import { DrizzleSecretRepository } from './infrastructure/drizzle-secret.repository.js';
import { LocalKeyWrapper } from './infrastructure/key-wrapper.js';

/** Encrypted storage for customers' secrets. Other modules depend on SecretVault only. */
@Module({
  providers: [
    {
      provide: EnvelopeCipher,
      inject: [AppConfig],
      // Swap LocalKeyWrapper for a KMS-backed wrapper when deploying to AWS.
      useFactory: (config: AppConfig) =>
        new AesGcmEnvelopeCipher(new LocalKeyWrapper(config.vault.keys)),
    },
    { provide: SecretRepository, useClass: DrizzleSecretRepository },
    SecretVault,
  ],
  exports: [SecretVault],
})
export class VaultModule {}
