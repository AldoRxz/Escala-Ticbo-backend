import type { Clock } from '../application/clock.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
