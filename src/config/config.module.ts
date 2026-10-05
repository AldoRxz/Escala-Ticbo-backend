import { type DynamicModule, Module } from '@nestjs/common';
import { AppConfig } from './app-config.js';

@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: AppConfig, useValue: config }],
      exports: [AppConfig],
    };
  }
}
