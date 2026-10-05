/** Source of the current time, injected so time-dependent rules are testable. */
export abstract class Clock {
  abstract now(): Date;
}
