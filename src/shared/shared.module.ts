import { Global, Module } from '@nestjs/common';
import { Clock } from './application/clock.js';
import { SystemClock } from './infrastructure/system-clock.js';

@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class SharedModule {}
