import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  computeStaleNotes,
  createEngineStateTracker,
  type ConflictRef,
} from "../../src/sync/state.js";
import { createStore, putNote } from "../../src/index/store.js";
import type { IndexedNote } from "../../src/index/types.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import { FIXTURE_VAULT_DIR } from "../helpers/create-test-vault.js";

// Task 3.7 [RED first]: state.ts — the EngineState snapshot (design §7):
// last successful sync, pending-write count, open conflicts, stale notes
// (lifecycle staleness vs Clock.now()), format version, push paused,
// lock owner. Durable state stays vault + git (OD-5); this is the
// in-memory projection the `status` tool reports.

const NOW = new Date("2026-07-14T10:30:00.000Z");

function clock() {
  return { now: () => new Date(NOW) };
}

function note(overrides: Partial<IndexedNote> = {}): IndexedNote {
  return {
    id: "SPEC-a",
    type: "spec",
    title: "Spec A",
    path: "specs/a.md",
    tags: [],
    frontmatter: {},
    body: "",
    wikilinks: [],
    ...overrides,
  };
}

async function loadRules(): Promise<RulesModel> {
  const raw = await readFile(path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

describe("createEngineStateTracker — initial snapshot", () => {
  it("starts idle: no sync yet, no pending writes, no conflicts, engine-owned defaults", async () => {
    const tracker = createEngineStateTracker({
      rules: await loadRules(),
      store: createStore(),
      clock: clock(),
    });
    expect(tracker.snapshot()).toEqual({
      lastSuccessfulSyncAt: null,
      pendingWrites: 0,
      conflicts: [],
      staleNotes: [],
      formatVersion: "1.0",
      pushPaused: false,
      lockOwner: null,
    });
  });
});

describe("createEngineStateTracker — staleness (lifecycle vs Clock.now())", () => {
  it("flags notes whose staleness field is before now, sorted deterministically; others untouched", async () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-stale", path: "specs/stale.md", frontmatter: { review_after: "2020-01-01" } }));
    putNote(store, note({ id: "SPEC-fresh", path: "specs/fresh.md", frontmatter: { review_after: "2030-01-01" } }));
    putNote(store, note({ id: "SPEC-nodate", path: "specs/nodate.md", frontmatter: {} }));
    putNote(store, note({ id: "SPEC-garbage", path: "specs/garbage.md", frontmatter: { review_after: "not a date" } }));

    const tracker = createEngineStateTracker({
      rules: await loadRules(),
      store,
      clock: clock(),
    });
    const { staleNotes } = tracker.snapshot();
    expect(staleNotes).toEqual([
      { id: "SPEC-stale", title: "Spec A", path: "specs/stale.md", type: "spec" },
    ]);
  });

  it("computeStaleNotes is exported standalone (status.ts delegates to it)", async () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-s", path: "specs/s.md", frontmatter: { review_after: "2000-01-01" } }));
    const stale = computeStaleNotes(store, await loadRules(), clock());
    expect(stale.map((s) => s.id)).toEqual(["SPEC-s"]);
  });
});

describe("createEngineStateTracker — engine mutations", () => {
  it("records successful syncs as ISO strings through the injected Clock", async () => {
    const tracker = createEngineStateTracker({
      rules: await loadRules(),
      store: createStore(),
      clock: clock(),
    });
    tracker.setLastSuccessfulSync(NOW);
    expect(tracker.snapshot().lastSuccessfulSyncAt).toBe("2026-07-14T10:30:00.000Z");
  });

  it("carries pending writes, open conflicts, push pause, and lock ownership", async () => {
    const tracker = createEngineStateTracker({
      rules: await loadRules(),
      store: createStore(),
      clock: clock(),
    });
    tracker.setPendingWrites(3);
    const conflict: ConflictRef = {
      noteId: "DEC-0042",
      notePath: "decisions/DEC-0042-fts5.md",
      snapshotBranch: "conflict/20260714-1030-DEC-0042",
      conflictNotePath: "conflicts/20260714-1030-DEC-0042.md",
      detectedAt: "2026-07-14T10:30:00.000Z",
    };
    tracker.setConflicts([conflict]);
    tracker.setPushPaused(true);
    tracker.setLockOwner("server");

    expect(tracker.snapshot()).toMatchObject({
      pendingWrites: 3,
      conflicts: [conflict],
      pushPaused: true,
      lockOwner: "server",
    });

    // Clearing is part of the lifecycle (resolve flips conflicts, push resumes).
    tracker.setConflicts([]);
    tracker.setPushPaused(false);
    tracker.setLockOwner(null);
    expect(tracker.snapshot()).toMatchObject({ conflicts: [], pushPaused: false, lockOwner: null });
  });

  it("setRules updates formatVersion and staleness on the next snapshot (rules-reloaded)", async () => {
    const rules = await loadRules();
    const store = createStore();
    putNote(store, note({ id: "SPEC-s", path: "specs/s.md", frontmatter: { review_after: "2000-01-01" } }));
    const tracker = createEngineStateTracker({ rules, store, clock: clock() });
    expect(tracker.snapshot().staleNotes).toHaveLength(1);

    const reloaded: RulesModel = {
      ...rules,
      formatVersion: "1.1",
      lifecycle: { ...rules.lifecycle, staleness: { field: "review_before", onStale: "flag" } },
    };
    tracker.setRules(reloaded);
    const snapshot = tracker.snapshot();
    expect(snapshot.formatVersion).toBe("1.1");
    expect(snapshot.staleNotes).toEqual([]); // different staleness field: nothing stale now
  });
});
