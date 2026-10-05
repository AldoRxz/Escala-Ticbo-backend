import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap/create-app.js';
import { loadConfig } from './config/load-config.js';

// Local development reads .env; deployed environments inject real variables.
if (process.env.NODE_ENV !== 'production' && existsSync('.env')) {
  process.loadEnvFile('.env');
}

try {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.http.port, config.http.host);
  Logger.log(
    `Ticbo API ${config.version} listening on ${config.http.host}:${config.http.port}`,
    'Bootstrap',
  );
} catch (error) {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error.stack : undefined,
    'Bootstrap',
  );
  process.exit(1);
}
