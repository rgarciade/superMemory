import type { Cancel, TimerPort } from "../../src/util/clock.js";

/**
 * ManualTimerPort — the queue-based TimerPort fake (design OD-4 / task
 * 3.9). Timers never fire on their own: tests drive them explicitly,
 * which keeps the scheduler's and the engine's backoff timing
 * deterministic and race-free. Every scheduled timer is recorded with
 * its delay so tests can assert the exact backoff sequence.
 */

export interface ScheduledTimer {
  kind: "set" | "every";
  delayMs: number;
  fn: () => void;
  cancelled: boolean;
  fired: boolean;
}

export class ManualTimerPort implements TimerPort {
  readonly timers: ScheduledTimer[] = [];

  set(delayMs: number, fn: () => void): Cancel {
    const timer: ScheduledTimer = { kind: "set", delayMs, fn, cancelled: false, fired: false };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  }

  every(intervalMs: number, fn: () => void): Cancel {
    const timer: ScheduledTimer = {
      kind: "every",
      delayMs: intervalMs,
      fn,
      cancelled: false,
      fired: false,
    };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  }

  /** One-shot timers in scheduling order (the backoff sequence's shape). */
  oneShots(): ScheduledTimer[] {
    return this.timers.filter((t) => t.kind === "set");
  }

  /** Delays of one-shot timers, including cancelled ones (assert on me). */
  oneShotDelays(): number[] {
    return this.oneShots().map((t) => t.delayMs);
  }

  /** Fires the oldest pending one-shot timer. Returns false when none remain. */
  fireNext(): boolean {
    const timer = this.oneShots().find((t) => !t.cancelled && !t.fired);
    if (!timer) return false;
    timer.fired = true;
    timer.fn();
    return true;
  }

  /**
   * Fires one-shot timers as they appear (a cycle's backoff sleeps
   * re-arm while the awaited cycle is still running) until none remain.
   * Yields to the microtask queue between fires so awaited continuations
   * can schedule the next timer.
   */
  async drain(): Promise<void> {
    for (let guard = 0; guard < 1000; guard++) {
      if (!this.fireNext()) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("ManualTimerPort.drain: guard budget exhausted");
  }

  /**
   * Drains until `done` settles — for awaited flows whose timers are
   * scheduled DURING the awaited work (the engine registers its backoff
   * sleep only after the git ops that precede the failing push). Polls
   * with a 10ms real-timer tick between idle checks; the timers
   * themselves still fire instantly and deterministically.
   */
  async drainUntil(done: Promise<unknown>): Promise<void> {
    for (let guard = 0; guard < 10_000; guard++) {
      if (this.fireNext()) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        continue;
      }
      const winner = await Promise.race([
        done.then(
          () => "done" as const,
          () => "done" as const,
        ),
        new Promise((resolve) => setTimeout(resolve, 10)).then(() => "tick" as const),
      ]);
      if (winner === "done") return;
    }
    throw new Error("ManualTimerPort.drainUntil: guard budget exhausted");
  }
}
