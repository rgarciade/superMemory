import type { IndexStore } from "../index/store.js";
import type { IndexedNote } from "../index/types.js";
import { listNotes } from "../index/queries.js";
import type { RulesModel } from "../rules/types.js";
import type { Clock } from "../util/clock.js";

/**
 * The engine's status snapshot (design §7) — the in-memory projection
 * the `status` tool reports. Durable state is the vault + git (OD-5);
 * nothing here is persisted. The tracker owns the engine-mutable fields
 * and derives the vault-derived ones (stale notes, format version) fresh
 * on every snapshot, so a rules reload or an index upsert is reflected
 * immediately.
 */

export interface StaleNoteRef {
  id: string;
  title: string;
  path: string;
  type: string;
}

export interface ConflictRef {
  noteId: string;
  notePath: string;
  snapshotBranch?: string;
  conflictNotePath: string;
  detectedAt: string;
}

export interface EngineState {
  lastSuccessfulSyncAt: string | null;
  pendingWrites: number;
  conflicts: ConflictRef[];
  staleNotes: StaleNoteRef[];
  formatVersion: string;
  pushPaused: boolean;
  lockOwner: string | null;
}

export interface EngineStateTracker {
  snapshot(): EngineState;
  /** The completion marker of a successful push (ISO via the injected Clock). */
  setLastSuccessfulSync(at: Date | null): void;
  setPendingWrites(count: number): void;
  setConflicts(conflicts: ConflictRef[]): void;
  setPushPaused(paused: boolean): void;
  setLockOwner(owner: string | null): void;
  /** The post-sync rules hook (`rules-reloaded`) swaps the model in. */
  setRules(rules: RulesModel): void;
}

export interface EngineStateDeps {
  rules: RulesModel;
  store: IndexStore;
  clock: Clock;
}

export function createEngineStateTracker(deps: EngineStateDeps): EngineStateTracker {
  let rules = deps.rules;
  let lastSuccessfulSyncAt: Date | null = null;
  let pendingWrites = 0;
  let conflicts: ConflictRef[] = [];
  let pushPaused = false;
  let lockOwner: string | null = null;

  return {
    snapshot(): EngineState {
      return {
        lastSuccessfulSyncAt: lastSuccessfulSyncAt?.toISOString() ?? null,
        pendingWrites,
        conflicts,
        staleNotes: computeStaleNotes(deps.store, rules, deps.clock),
        formatVersion: rules.formatVersion,
        pushPaused,
        lockOwner,
      };
    },
    setLastSuccessfulSync(at) {
      lastSuccessfulSyncAt = at;
    },
    setPendingWrites(count) {
      pendingWrites = count;
    },
    setConflicts(next) {
      conflicts = next;
    },
    setPushPaused(paused) {
      pushPaused = paused;
    },
    setLockOwner(owner) {
      lockOwner = owner;
    },
    setRules(next) {
      rules = next;
    },
  };
}

/**
 * Stale notes per `rules.lifecycle.staleness` (default field none): a
 * note is stale when its staleness field holds a date earlier than
 * `clock.now()`. Deterministically sorted by path. Shared with the
 * `status` tool (P2 stub and P3 engine both report the same list).
 */
export function computeStaleNotes(
  store: IndexStore,
  rules: RulesModel,
  clock: Clock,
): StaleNoteRef[] {
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
