import { createLambdaHandler } from './bootstrap/create-lambda-handler.js';
import { loadConfig } from './config/load-config.js';

// AWS Lambda entry point (API Gateway HTTP API). Initialization happens once per
// execution environment, during the init phase; invalid configuration fails it.
export const handler = await createLambdaHandler(loadConfig());
