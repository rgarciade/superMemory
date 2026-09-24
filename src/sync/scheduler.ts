import type { SyncTunables } from "../config/vault-config.js";
import type { Clock, TimerPort } from "../util/clock.js";
import { createLogger } from "../util/log.js";
import type { SyncTrigger } from "./engine.js";

/**
 * The sync scheduler (design §4.2) — trailing-edge debounce plus an
 * interval fallback, built ONLY on the injected TimerPort + Clock (OD-4).
 * The scheduler owns no git logic: its sole job is calling `runCycle`
 * with the right trigger at the right time.
 *
 * - **Debounce** (default 45 s, `tunables.debounceMs`): every write
 *   notification RESETS the trailing-edge timer — one cycle fires exactly
 *   `debounceMs` after the last write, no matter how many writes happened
 *   inside the window.
 * - **Interval fallback** (default 15 min, `tunables.intervalMs`): a
 *   repeating timer guarantees slow-changing vaults still sync.
 *
 * The production TimerPort (`SystemTimerPort`) `.unref()`s every timer, so
 * a pending debounce never keeps a CLI process alive; the server lives
 * regardless. `stop()` makes the instance fully inert (the server runs it
 * for the process lifetime; the CLI never creates one). Cycles are
 * fire-and-forget: a rejected `runCycle` is logged on stderr, never
 * thrown into the timer callback.
 */

export interface SchedulerDeps {
  /** The engine's one-cycle entry — the ONLY thing the scheduler calls. */
  runCycle(trigger: SyncTrigger): Promise<unknown>;
  /** Static tunables or a provider (re-read per schedule; reload-aware). */
  tunables: SyncTunables | (() => SyncTunables);
  timer: TimerPort;
  clock: Clock;
}

export interface SyncScheduler {
  /** Arms the interval fallback. Idempotent. */
  start(): void;
  /** Cancels everything; the instance goes inert. */
  stop(): void;
  /** Resets the trailing-edge debounce window (the save pipeline's hook). */
  notifyWrite(): void;
  /** Milliseconds until the pending debounce fires; null when none. */
  pendingDebounceMs(): number | null;
}

const log = createLogger();

export function createSyncScheduler(deps: SchedulerDeps): SyncScheduler {
  let stopped = false;
  let started = false;
  let intervalCancel: { cancel(): void } | null = null;
  let debounceCancel: { cancel(): void } | null = null;
  let debounceDeadlineEpochMs: number | null = null;

  function tunables(): SyncTunables {
    return typeof deps.tunables === "function" ? deps.tunables() : deps.tunables;
  }

  function triggerCycle(trigger: SyncTrigger): void {
    deps.runCycle(trigger).catch((err: unknown) => {
      log.error(
        `sync scheduler: ${trigger} cycle failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  function clearDebounce(): void {
    debounceCancel?.cancel();
    debounceCancel = null;
    debounceDeadlineEpochMs = null;
  }

  return {
    start(): void {
      if (stopped || started) return;
      started = true;
      intervalCancel = deps.timer.every(tunables().intervalMs, () => {
        triggerCycle("interval");
      });
    },

    stop(): void {
      if (stopped) return;
      stopped = true;
      intervalCancel?.cancel();
      intervalCancel = null;
      clearDebounce();
    },

    notifyWrite(): void {
      if (stopped) return;
      clearDebounce();
      const delayMs = tunables().debounceMs;
      debounceCancel = deps.timer.set(delayMs, () => {
        debounceCancel = null;
        debounceDeadlineEpochMs = null;
        triggerCycle("debounce");
      });
      debounceDeadlineEpochMs = deps.clock.now().getTime() + delayMs;
    },

    pendingDebounceMs(): number | null {
      if (debounceDeadlineEpochMs === null) return null;
      return Math.max(0, debounceDeadlineEpochMs - deps.clock.now().getTime());
    },
  };
}
