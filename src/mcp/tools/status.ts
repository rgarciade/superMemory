import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { IndexStore } from "../../index/store.js";
import type { RulesModel } from "../../rules/types.js";
import { computeStaleNotes, type StaleNoteRef } from "../../sync/state.js";
import type { Clock } from "../../util/clock.js";

export type { StaleNoteRef } from "../../sync/state.js";

/**
 * `status` — engine visibility (tool-catalog spec: "sync and status —
 * engine visibility"). P2 ships a documented stub coded against the
 * future `EngineState` shape (design §7): the engine-owned fields
 * (pending writes, conflicts, last successful sync, push-paused, lock
 * owner) are stubbed to their empty/idle values until P3's engine lands
 * — no schema change when it does. `staleNotes` and `formatVersion` are
 * NOT stubbed: they're genuinely computable today from the index +
 * `rules.lifecycle.staleness` + an injected `Clock` (OD-4), with no
 * engine dependency at all — the computation lives in `sync/state.ts`
 * (task 3.7) so the stub and the future engine report the same list.
 */

export interface StatusDeps {
  store: IndexStore;
  rules: RulesModel;
  clock: Clock;
}

export interface EngineStateStub {
  lastSuccessfulSyncAt: string | null;
  pendingWrites: number;
  conflicts: unknown[];
  staleNotes: StaleNoteRef[];
  formatVersion: string;
  pushPaused: boolean;
  lockOwner: string | null;
  /** Documents the stub, per the tool-catalog spec's ship note. */
  note: string;
}

export const ENGINE_STUB_NOTE = "engine lands in P3; supermemory sync / plain git still work";

export function buildEngineStateStub(deps: StatusDeps): EngineStateStub {
  return {
    lastSuccessfulSyncAt: null,
    pendingWrites: 0,
    conflicts: [],
    staleNotes: computeStaleNotes(deps.store, deps.rules, deps.clock),
    formatVersion: deps.rules.formatVersion,
    pushPaused: false,
    lockOwner: null,
    note: ENGINE_STUB_NOTE,
  };
}

export function createStatusHandler(deps: StatusDeps) {
  return (): CallToolResult => toResult(buildEngineStateStub(deps));
}

function toResult(payload: EngineStateStub): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    // Spread into a fresh object literal: anonymous shapes carry implicit
    // index signatures (interfaces don't), so no cast is needed.
    structuredContent: { ...payload },
  };
}
