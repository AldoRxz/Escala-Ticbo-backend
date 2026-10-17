import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { Clock } from './application/clock.js';
import { ObjectStorage } from './application/object-storage.js';
import { FilesystemObjectStorage } from './infrastructure/storage/filesystem-object-storage.js';
import { S3ObjectStorage } from './infrastructure/storage/s3-object-storage.js';
import { UnconfiguredObjectStorage } from './infrastructure/storage/unconfigured-object-storage.js';
import { SystemClock } from './infrastructure/system-clock.js';

@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    {
      provide: ObjectStorage,
      inject: [AppConfig],
      useFactory: ({ storage }: AppConfig): ObjectStorage => {
        switch (storage.driver) {
          case 's3':
            return new S3ObjectStorage(storage);
          case 'filesystem':
            return new FilesystemObjectStorage(storage.directory);
          case 'none':
            return new UnconfiguredObjectStorage();
        }
      },
    },
  ],
  exports: [Clock, ObjectStorage],
})
export class SharedModule {}
