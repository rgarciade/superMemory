import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { listNotes } from "../../index/queries.js";
import type { IndexStore } from "../../index/store.js";
import type { IndexedNote } from "../../index/types.js";
import type { RulesModel } from "../../rules/types.js";
import type { Clock } from "../../util/clock.js";

/**
 * `status` — engine visibility (tool-catalog spec: "sync and status —
 * engine visibility"). P2 ships a documented stub coded against the
 * future `EngineState` shape (design §7): the engine-owned fields
 * (pending writes, conflicts, last successful sync, push-paused, lock
 * owner) are stubbed to their empty/idle values until P3's engine lands
 * — no schema change when it does. `staleNotes` and `formatVersion` are
 * NOT stubbed: they're genuinely computable today from the index +
 * `rules.lifecycle.staleness` + an injected `Clock` (OD-4), with no
 * engine dependency at all.
 */

export interface StatusDeps {
  store: IndexStore;
  rules: RulesModel;
  clock: Clock;
}

export interface StaleNoteRef {
  id: string;
  title: string;
  path: string;
  type: string;
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

function computeStaleNotes(store: IndexStore, rules: RulesModel, clock: Clock): StaleNoteRef[] {
  const field = rules.lifecycle.staleness?.field;
  if (!field) return [];
  const now = clock.now();
  const stale: StaleNoteRef[] = [];
  for (const note of listNotes(store)) {
    if (isStale(note, field, now)) {
      stale.push({ id: note.id, title: note.title, path: note.path, type: note.type });
    }
  }
  return stale.sort((a, b) => a.path.localeCompare(b.path));
}

function isStale(note: IndexedNote, field: string, now: Date): boolean {
  const raw = note.frontmatter[field];
  const date = toDate(raw);
  return date !== undefined && date < now;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

function toResult(payload: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}
