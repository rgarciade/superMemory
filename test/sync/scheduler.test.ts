import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyncScheduler, type SchedulerDeps } from "../../src/sync/scheduler.js";
import { SystemTimerPort } from "../../src/util/clock.js";
import { resolveSyncTunables, type SyncTunables } from "../../src/config/vault-config.js";
import type { RulesModel } from "../../src/rules/types.js";
import { ManualTimerPort } from "../helpers/manual-timer-port.js";

// Task 3.9 [RED first]: scheduler.ts — trailing-edge debounce (default
// 45 s) + interval fallback (default 15 min), built ONLY on TimerPort +
// Clock; triggers runCycle and nothing else. Unit tests drive a
// ManualTimerPort queue; the production SystemTimerPort wiring is proven
// separately under vi.useFakeTimers() + advanceTimersByTimeAsync (OD-4).

const TUNABLES: SyncTunables = { intervalMs: 900_000, debounceMs: 45_000 };

interface Harness {
  timers: ManualTimerPort;
  cycles: string[];
  scheduler: ReturnType<typeof createSyncScheduler>;
}

function harness(
  overrides: Partial<SchedulerDeps> & {
    tunables?: SyncTunables | (() => SyncTunables);
  } = {},
): Harness {
  const timers = new ManualTimerPort();
  const cycles: string[] = [];
  const scheduler = createSyncScheduler({
    runCycle: async (trigger) => {
      cycles.push(trigger);
    },
    tunables: overrides.tunables ?? TUNABLES,
    timer: timers,
    clock: { now: () => new Date("2025-06-01T12:00:00.000Z") },
    ...overrides,
  });
  return { timers, cycles, scheduler };
}

describe("createSyncScheduler — debounce (ManualTimerPort)", () => {
  it("a write schedules a trailing-edge debounce firing runCycle('debounce') after the tunable delay", () => {
    const { timers, cycles, scheduler } = harness();
    scheduler.start();
    scheduler.notifyWrite();

    expect(timers.oneShotDelays()).toEqual([45_000]);
    expect(cycles).toEqual([]);

    expect(timers.fireNext()).toBe(true);
    expect(cycles).toEqual(["debounce"]);
  });

  it("every write resets the window — only the LAST write's timer fires (trailing edge)", () => {
    const { timers, cycles, scheduler } = harness();
    scheduler.start();

    scheduler.notifyWrite(); // write A
    scheduler.notifyWrite(); // write B resets A's timer

    // exactly one live one-shot: A's was cancelled, B's is the trailing edge
    expect(timers.oneShots().filter((t) => !t.cancelled)).toHaveLength(1);
    expect(timers.oneShotDelays()).toEqual([45_000, 45_000]);
    expect(timers.fireNext()).toBe(true);
    expect(cycles).toEqual(["debounce"]);
    expect(timers.fireNext()).toBe(false); // A's cancelled timer never fires
    expect(cycles).toEqual(["debounce"]); // exactly ONE cycle for both writes
  });

  it("notifyWrite works before start() — a lone debounce still leads to a cycle", () => {
    const { timers, cycles, scheduler } = harness();
    scheduler.notifyWrite();
    expect(timers.fireNext()).toBe(true);
    expect(cycles).toEqual(["debounce"]);
  });

  it("re-reads tunables per schedule (provider form)", () => {
    let debounceMs = 1_000;
    const { timers, scheduler } = harness({
      tunables: () => ({ intervalMs: 60_000, debounceMs }),
    });
    scheduler.start();
    scheduler.notifyWrite();
    expect(timers.oneShotDelays()).toEqual([1_000]);

    debounceMs = 5_000;
    scheduler.notifyWrite(); // reset — re-reads the provider
    expect(timers.oneShotDelays()).toEqual([1_000, 5_000]);
  });

  it("pendingDebounceMs reports the live window and nulls after fire/cancel", () => {
    const { timers, scheduler } = harness();
    scheduler.start();
    expect(scheduler.pendingDebounceMs()).toBeNull();

    scheduler.notifyWrite();
    expect(scheduler.pendingDebounceMs()).toBe(45_000);

    timers.fireNext();
    expect(scheduler.pendingDebounceMs()).toBeNull();
  });
});

describe("createSyncScheduler — interval fallback (ManualTimerPort)", () => {
  it("start() arms a repeating interval firing runCycle('interval') on the tunable cadence", () => {
    const { timers, cycles, scheduler } = harness();
    scheduler.start();

    const every = timers.timers.find((t) => t.kind === "every");
    expect(every?.delayMs).toBe(900_000);

    every?.fn();
    expect(cycles).toEqual(["interval"]);
    every?.fn(); // repeating — fires again on the next tick
    expect(cycles).toEqual(["interval", "interval"]);
  });

  it("start() is idempotent — a second call never double-arms the interval", () => {
    const { timers, scheduler } = harness();
    scheduler.start();
    scheduler.start();

    const everies = timers.timers.filter((t) => t.kind === "every" && !t.cancelled);
    expect(everies).toHaveLength(1);
  });

  it("stop() cancels the interval and any pending debounce; later writes are inert", () => {
    const { timers, cycles, scheduler } = harness();
    scheduler.start();
    scheduler.notifyWrite();
    scheduler.stop();

    expect(timers.timers.every((t) => t.cancelled)).toBe(true);
    expect(timers.fireNext()).toBe(false);
    expect(cycles).toEqual([]);

    scheduler.notifyWrite(); // after stop the scheduler is fully inert
    expect(timers.oneShots().filter((t) => !t.cancelled)).toHaveLength(0);
    expect(cycles).toEqual([]);
  });
});

describe("createSyncScheduler — error containment", () => {
  it("a rejected runCycle does not escape the timer callback", async () => {
    const timers = new ManualTimerPort();
    const scheduler = createSyncScheduler({
      runCycle: async () => {
        throw new Error("cycle blew up");
      },
      tunables: TUNABLES,
      timer: timers,
      clock: { now: () => new Date() },
    });
    scheduler.start();
    scheduler.notifyWrite();

    // vitest fails the test on unhandled rejections — simply surviving
    // the fire IS the assertion
    expect(() => timers.fireNext()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("createSyncScheduler — production wiring (SystemTimerPort + fake timers)", () => {
  it("the real timer impl fires the debounce and the interval under vi.useFakeTimers", async () => {
    vi.useFakeTimers();
    try {
      const cycles: string[] = [];
      const scheduler = createSyncScheduler({
        runCycle: async (trigger) => {
          cycles.push(trigger);
        },
        tunables: TUNABLES,
        timer: new SystemTimerPort(),
        clock: { now: () => new Date() },
      });
      scheduler.start();

      scheduler.notifyWrite();
      await vi.advanceTimersByTimeAsync(44_999);
      expect(cycles).toEqual([]); // window not yet elapsed

      await vi.advanceTimersByTimeAsync(1);
      expect(cycles).toEqual(["debounce"]); // trailing edge fired at exactly 45 s

      await vi.advanceTimersByTimeAsync(900_000);
      expect(cycles).toEqual(["debounce", "interval"]); // interval fallback

      scheduler.stop();
      await vi.advanceTimersByTimeAsync(10_000_000);
      expect(cycles).toEqual(["debounce", "interval"]); // nothing further
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSyncScheduler — project-config timings (issue #5)", () => {
  const rules = { git: {} } as unknown as RulesModel;
  const noEnv = { get: () => undefined };
  const everyDelays = (t: ManualTimerPort): number[] =>
    t.timers.filter((x) => x.kind === "every").map((x) => x.delayMs);

  it("defaults (no overrides) arm 15 min interval and 45 s debounce", () => {
    const { timers, scheduler } = harness({
      tunables: () => resolveSyncTunables(noEnv, undefined, rules, {}),
    });
    scheduler.start();
    scheduler.notifyWrite();
    expect(everyDelays(timers)).toEqual([15 * 60_000]);
    expect(timers.oneShotDelays()).toEqual([45_000]);
  });

  it("custom project values are honored by the scheduler", () => {
    const { timers, scheduler } = harness({
      tunables: () =>
        resolveSyncTunables(noEnv, undefined, rules, {
          debounceSeconds: 10,
          syncIntervalMinutes: 5,
        }),
    });
    scheduler.start();
    scheduler.notifyWrite();
    expect(everyDelays(timers)).toEqual([5 * 60_000]);
    expect(timers.oneShotDelays()).toEqual([10_000]);
  });
});
