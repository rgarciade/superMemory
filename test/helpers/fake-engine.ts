import type { WriteEvent } from "../../src/notes/save-pipeline.js";
import type { CycleReport, SyncEngine, SyncTrigger } from "../../src/sync/engine.js";
import type { EngineState } from "../../src/sync/state.js";

/**
 * Fake SyncEngine for tool/server contract tests (3.13 wiring): records
 * the triggers it was cycled with, the write events journaled through
 * the save pipeline's SyncPort, and the pullLatest calls — and serves a
 * canned EngineState snapshot. The real engine's behavior is proven in
 * test/sync/engine.test.ts; this fake only pins the SEAM the tools and
 * the composition root depend on.
 */

export interface FakeEngine extends SyncEngine {
  cycles: SyncTrigger[];
  writes: WriteEvent[];
  pulls: Array<string | undefined>;
}

export interface FakeEngineOptions {
  state?: Partial<EngineState>;
  report?: Partial<CycleReport>;
  /** Make runCycle reject (error-path tests). */
  failCycleWith?: unknown;
}

export function fakeEngine(opts: FakeEngineOptions = {}): FakeEngine {
  const cycles: SyncTrigger[] = [];
  const writes: WriteEvent[] = [];
  const pulls: Array<string | undefined> = [];
  const state: EngineState = {
    lastSuccessfulSyncAt: null,
    pendingWrites: 0,
    conflicts: [],
    staleNotes: [],
    formatVersion: "1.0",
    pushPaused: false,
    lockOwner: null,
    ...opts.state,
  };
  return {
    cycles,
    writes,
    pulls,
    async runCycle(trigger: SyncTrigger): Promise<CycleReport> {
      cycles.push(trigger);
      if (opts.failCycleWith !== undefined) throw opts.failCycleWith;
      return {
        trigger,
        outcome: "idle",
        pushed: false,
        commits: [],
        blocked: [],
        conflicts: [],
        ...opts.report,
      };
    },
    notifyWrite(event: WriteEvent): void {
      writes.push(event);
    },
    pendingWriteCount(): number {
      return writes.length;
    },
    state(): EngineState {
      return state;
    },
    async pullLatest(notePath?: string): Promise<void> {
      pulls.push(notePath);
    },
  };
}
