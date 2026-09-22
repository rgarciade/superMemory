/**
 * Clock and timer ports (OD-4). Everything time-dependent (scheduler,
 * engine backoff, staleness) builds on these seams; production code never
 * touches globals directly.
 */

/** Backs every timestamp the engine records — injectable for tests. */
export interface Clock {
  now(): Date;
}

export interface Cancel {
  cancel(): void;
}

export interface TimerPort {
  /** One-shot timer after `delayMs` milliseconds. */
  set(delayMs: number, fn: () => void): Cancel;
  /** Repeating timer every `intervalMs` milliseconds. */
  every(intervalMs: number, fn: () => void): Cancel;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * Production timer port: wraps global setTimeout/setInterval and **unref()s
 * every timer** — a pending debounce/interval must never keep a CLI process
 * alive (OD-4); the server lives regardless.
 */
export class SystemTimerPort implements TimerPort {
  set(delayMs: number, fn: () => void): Cancel {
    const handle = setTimeout(fn, delayMs);
    handle.unref();
    return {
      cancel: () => {
        clearTimeout(handle);
      },
    };
  }

  every(intervalMs: number, fn: () => void): Cancel {
    const handle = setInterval(fn, intervalMs);
    handle.unref();
    return {
      cancel: () => {
        clearInterval(handle);
      },
    };
  }
}
