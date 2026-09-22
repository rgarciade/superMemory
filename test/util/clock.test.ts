import { describe, expect, it, vi, afterEach } from "vitest";
import {
  SystemClock,
  SystemTimerPort,
  type Clock,
  type TimerPort,
} from "../../src/util/clock.js";

// Task 1.7 [RED first]: Clock + TimerPort ports; production timers unref().
describe("SystemClock", () => {
  it("returns the current time as a Date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00Z"));
    const clock: Clock = new SystemClock();
    expect(clock.now().toISOString()).toBe("2025-06-01T12:00:00.000Z");
  });
});

describe("SystemTimerPort", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a one-shot timer via set()", async () => {
    vi.useFakeTimers();
    const timers: TimerPort = new SystemTimerPort();
    const fired = vi.fn();
    const cancel = timers.set(45_000, fired);
    expect(typeof cancel.cancel).toBe("function");
    await vi.advanceTimersByTimeAsync(45_000);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents the timer from firing", async () => {
    vi.useFakeTimers();
    const timers: TimerPort = new SystemTimerPort();
    const fired = vi.fn();
    const cancel = timers.set(1000, fired);
    cancel.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fired).not.toHaveBeenCalled();
  });

  it("fires an interval timer repeatedly via every()", async () => {
    vi.useFakeTimers();
    const timers: TimerPort = new SystemTimerPort();
    const fired = vi.fn();
    timers.every(15 * 60_000, fired);
    await vi.advanceTimersByTimeAsync(15 * 60_000 * 2);
    expect(fired).toHaveBeenCalledTimes(2);
  });

  it("production timers are unref'd (a pending timer never keeps the process alive)", () => {
    const unref = vi.fn();
    const origSetTimeout = globalThis.setTimeout;
    const origSetInterval = globalThis.setInterval;
    // Minimal fake handles: the port must call .unref() on whatever the
    // globals hand back (OD-4) — asserted directly, no real timers run.
    const makeHandle = () => ({ unref });
    globalThis.setTimeout = (() => makeHandle()) as unknown as typeof setTimeout;
    globalThis.setInterval = (() => makeHandle()) as unknown as typeof setInterval;
    try {
      const timers: TimerPort = new SystemTimerPort();
      timers.set(50, () => {});
      timers.every(50, () => {});
      expect(unref).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.setTimeout = origSetTimeout;
      globalThis.setInterval = origSetInterval;
    }
  });
});
