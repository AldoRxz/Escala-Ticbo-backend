import awsLambdaFastify from '@fastify/aws-lambda';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { AppConfig } from '../config/app-config.js';
import { createApp } from './create-app.js';

/**
 * Same application as the HTTP server, driven by API Gateway (HTTP API, payload
 * 2.0) events instead of a socket. Built once per Lambda execution environment
 * and reused by every invocation it serves.
 */
export async function createLambdaHandler(config: AppConfig) {
  const app = await createApp(config);
  await app.init();
  return awsLambdaFastify<APIGatewayProxyEventV2>(app.getHttpAdapter().getInstance(), {
    // Return as soon as the response is ready; pooled DB sockets stay open for
    // the next invocation instead of keeping this one (and its bill) running.
    callbackWaitsForEmptyEventLoop: false,
    binaryMimeTypes: ['application/pdf', 'application/zip', 'image/*'],
  });
}
