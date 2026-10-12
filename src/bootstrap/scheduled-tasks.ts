import type { INestApplicationContext } from '@nestjs/common';
import { PurgeExpiredAuthDataUseCase } from '../modules/iam/application/use-cases/purge-expired-auth-data.use-case.js';

/** What EventBridge Scheduler sends to the function (infra/template.yaml). */
export interface ScheduledTaskEvent {
  task: string;
}

export interface ScheduledTaskResult {
  task: string;
  result: unknown;
}

type Task = (app: INestApplicationContext) => Promise<unknown>;

const tasks: Record<string, Task> = {
  // Every few hours. Its writes are also the database activity that keeps a
  // Supabase free-plan project from pausing after a week without use.
  maintenance: (app) => app.get(PurgeExpiredAuthDataUseCase).execute(),
};

/** API Gateway events always carry `requestContext`; a scheduled task never does. */
export function isScheduledTaskEvent(event: unknown): event is ScheduledTaskEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'task' in event &&
    typeof event.task === 'string' &&
    !('requestContext' in event)
  );
}

export async function runScheduledTask(
  app: INestApplicationContext,
  event: ScheduledTaskEvent,
): Promise<ScheduledTaskResult> {
  const task = Object.hasOwn(tasks, event.task) ? tasks[event.task] : undefined;
  if (!task) {
    throw new Error(`Unknown scheduled task: ${event.task}`);
  }
  return { task: event.task, result: await task(app) };
}
