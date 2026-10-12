import awsLambdaFastify from '@fastify/aws-lambda';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import type { AppConfig } from '../config/app-config.js';
import { createApp } from './create-app.js';
import {
  isScheduledTaskEvent,
  runScheduledTask,
  type ScheduledTaskEvent,
  type ScheduledTaskResult,
} from './scheduled-tasks.js';

export interface LambdaHandler {
  (event: APIGatewayProxyEventV2, context: Context): Promise<awsLambdaFastify.LambdaResponse>;
  (event: ScheduledTaskEvent, context: Context): Promise<ScheduledTaskResult>;
}

/**
 * Same application as the HTTP server, driven by API Gateway (HTTP API, payload
 * 2.0) events instead of a socket, plus the tasks EventBridge Scheduler invokes.
 * Built once per Lambda execution environment and reused by every invocation.
 */
export async function createLambdaHandler(config: AppConfig): Promise<LambdaHandler> {
  const app = await createApp(config);
  await app.init();
  const http = awsLambdaFastify<APIGatewayProxyEventV2>(app.getHttpAdapter().getInstance(), {
    // Return as soon as the response is ready; pooled DB sockets stay open for
    // the next invocation instead of keeping this one (and its bill) running.
    callbackWaitsForEmptyEventLoop: false,
    binaryMimeTypes: ['application/pdf', 'application/zip', 'image/*'],
  });

  return ((event: APIGatewayProxyEventV2 | ScheduledTaskEvent, context: Context) => {
    if (isScheduledTaskEvent(event)) {
      context.callbackWaitsForEmptyEventLoop = false;
      return runScheduledTask(app, event);
    }
    return http(event, context);
  }) as LambdaHandler;
}
