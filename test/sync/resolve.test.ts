import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSyncEngine } from "../../src/sync/engine.js";
import { PidfileLock } from "../../src/sync/lock.js";
import { createGitClient } from "../../src/sync/git.js";
import { createEngineStateTracker } from "../../src/sync/state.js";
import { createStore } from "../../src/index/store.js";
import type { Clock } from "../../src/util/clock.js";
import type { RulesModel } from "../../src/rules/types.js";
import type { SyncTunables } from "../../src/config/vault-config.js";
import { createTestVault, type TestVault } from "../helpers/create-test-vault.js";
import { connectVaultToRemote, type RemoteVault } from "../helpers/remote-vault.js";
import { MemoryLockRegistry } from "../helpers/memory-lock-registry.js";
import { ManualTimerPort } from "../helpers/manual-timer-port.js";
import {
  finalizeResolution,
  listOpenConflicts,
  materializeConflictSides,
  runResolve,
  type MergePromptContext,
  type ResolveDeps,
  type ResolvePromptPort,
  type ConflictNoteRecord,
  type ResolveOutcome,
} from "../../src/sync/resolve.js";

// Task 3.10 [RED first]: resolve.ts — the guided flow (design §4.4 step
// 5): list open conflicts from conflict notes; materialize
// `<note>.local.md` (working tree) + `<note>.remote.md` (snapshot
// branch) side by side next to the conflict note; prompt the merge into
// the real path through an injectable port (no CLI wiring here — 3.12);
// finalize: commit `note(update): … (conflict resolved)` via the shared
// grammar, push, flip the conflict note to `status: resolved`; snapshot
// branch retained. Secrets lint runs at finalization (design §4.6).
// Because the curated path ABORTED the rebase, finalize first
// integrates the diverged remote (pull --rebase --autostash, settling
// the replayed local commit with the local side) so the push is a fast
// —forward; the merged note is the human's decision and the snapshot
// branch keeps the incoming side recoverable (never silently delete).

const execFileAsync = promisify(execFile);

const NOW = new Date("2025-06-01T12:00:00.000Z");

class FixedClock implements Clock {
  now(): Date {
    return new Date(NOW);
  }
}

const AUTHOR = { name: "Jane Doe", email: "jane@example.com" };

function rulesModel(): RulesModel {
  return {
    formatVersion: "1.0",
    noteTypes: {
      spec: { folder: "specs/", frontmatter: {}, conflictPolicy: "human_required" },
      session_log: { folder: "logs/", frontmatter: {}, conflictPolicy: "union" },
    },
    lifecycle: {},
    conflictPolicyDefaults: {},
    git: {},
  };
}

const TUNABLES: SyncTunables = { intervalMs: 900_000, debounceMs: 45_000 };

function specNote(id: string, title: string): string {
  return `---\nspec_id: ${id}\nstatus: draft\nowner: team\n---\n\n# ${title}\n\nBody text.\n`;
}

interface ConflictedState {
  vault: TestVault;
  remote: RemoteVault;
  deps: ResolveDeps;
  /** Open conflict records as the engine wrote them (name-sorted). */
  records: Awaited<ReturnType<typeof listOpenConflicts>>;
}

/**
 * Two divergent curated conflicts created by the REAL engine path
 * (diverge both specs remotely, edit both locally, runCycle aborts the
 * rebase for the curated pair) — the exact state `supermemory resolve`
 * meets in production.
 */
async function conflictedVault(): Promise<ConflictedState> {
  const vault = await createTestVault({
    seedNotes: [
      { path: "specs/SPEC-9.md", content: specNote("SPEC-9", "Base Nine") },
      { path: "specs/SPEC-10.md", content: specNote("SPEC-10", "Base Ten") },
    ],
  });
  const remote = await connectVaultToRemote(vault);
  await remote.diverge("specs/SPEC-9.md", specNote("SPEC-9", "Remote Nine"));
  await remote.diverge("specs/SPEC-10.md", specNote("SPEC-10", "Remote Ten"));
  await vault.write("specs/SPEC-9.md", specNote("SPEC-9", "Local Nine"));
  await vault.write("specs/SPEC-10.md", specNote("SPEC-10", "Local Ten"));
  await vault.commit("test: local-side edits on both specs");

  const rules = rulesModel();
  const git = createGitClient(vault.root);
  const engine = createSyncEngine({
    vaultPath: vault.root,
    store: createStore(),
    rules,
    tunables: TUNABLES,
    clock: new FixedClock(),
    timer: new ManualTimerPort(),
    lock: new PidfileLock({
      vaultRoot: vault.root,
      storage: new MemoryLockRegistry(),
      pid: 424_242,
    }),
    git,
    index: {
      reparse: async () => {},
      regenerateMaps: async () => ({ changedPaths: [], noteCount: 2 }),
    },
    reloadRules: async () => rules,
    author: AUTHOR,
    state: createEngineStateTracker({ rules, store: createStore(), clock: new FixedClock() }),
  });
  const report = await engine.runCycle("manual");
  if (report.outcome !== "conflict") {
    throw new Error(`fixture expected a curated conflict, got ${report.outcome}`);
  }

  const deps: ResolveDeps = {
    vaultPath: vault.root,
    rules,
    git,
    prompt: nullPrompt(),
    author: AUTHOR,
    via: "cli",
  };
  return {
    vault,
    remote,
    deps,
    records: await listOpenConflicts(path.join(vault.root, "conflicts")),
  };
}

function nullPrompt(): ResolvePromptPort {
  return { mergeSides: async () => null, confirmFinalize: async () => false };
}

interface ScriptedPrompt extends ResolvePromptPort {
  calls: MergePromptContext[];
  confirmCalls: number;
}

function scriptedPrompt(
  merge: (ctx: MergePromptContext) => string | null,
  confirm = true,
): ScriptedPrompt {
  const calls: MergePromptContext[] = [];
  const port = {
    calls,
    confirmCalls: 0,
    async mergeSides(ctx: MergePromptContext) {
      calls.push(ctx);
      return merge(ctx);
    },
    async confirmFinalize() {
      port.confirmCalls += 1;
      return confirm;
    },
  };
  return port;
}

async function lastSubjects(root: string): Promise<string[]> {
  const out = await execFileAsync("git", ["log", "--format=%s"], { cwd: root });
  return out.stdout.split("\n").filter((line) => line !== "");
}

async function lastAuthor(root: string): Promise<string> {
  const out = await execFileAsync("git", ["log", "-1", "--format=%an"], { cwd: root });
  return out.stdout.trim();
}

async function revParse(root: string, ref: string): Promise<string> {
  const git = createGitClient(root);
  return git.revParse(ref);
}

const MERGED_NINE = specNote("SPEC-9", "Merged Nine");
const MERGED_TEN = specNote("SPEC-10", "Merged Ten");

describe("listOpenConflicts", () => {
  it("lists the engine's open conflict notes with their machine contract", async () => {
    const state = await conflictedVault();
    try {
      expect(state.records).toHaveLength(2);
      const nine = state.records.find((r: ConflictNoteRecord) => r.noteId === "SPEC-9");
      expect(nine).toMatchObject({
        status: "open",
        notePath: "specs/SPEC-9.md",
        snapshotBranch: "conflict/20250601-1200-SPEC-9",
      });
      expect(nine?.path).toBe(
        path.join(state.vault.root, "conflicts", "20250601-1200-SPEC-9.md"),
      );
    } finally {
      await state.remote.cleanup();
    }
  });

  it("excludes conflicts whose note has been flipped to resolved", async () => {
    const state = await conflictedVault();
    try {
      const nine = state.records.find((r: ConflictNoteRecord) => r.noteId === "SPEC-9");
      const raw = await readFile(nine!.path, "utf8");
      await writeFile(nine!.path, raw.replace("status: open", "status: resolved"), "utf8");
      const open = await listOpenConflicts(path.join(state.vault.root, "conflicts"));
      expect(open.map((r: ConflictNoteRecord) => r.noteId)).toEqual(["SPEC-10"]);
    } finally {
      await state.remote.cleanup();
    }
  });
});

describe("materializeConflictSides", () => {
  it("writes <note>.local.md (working tree) and <note>.remote.md (snapshot branch) next to the conflict note", async () => {
    const state = await conflictedVault();
    try {
      const nine = state.records.find((r: ConflictNoteRecord) => r.noteId === "SPEC-9")!;
      const sides = await materializeConflictSides(state.deps, nine);

      expect(sides.localPath).toBe(path.join(state.vault.root, "conflicts", "SPEC-9.local.md"));
      expect(sides.remotePath).toBe(path.join(state.vault.root, "conflicts", "SPEC-9.remote.md"));
      expect(sides.localContent).toContain("Local Nine");
      expect(sides.remoteContent).toContain("Remote Nine");
      expect(await readFile(sides.localPath, "utf8")).toContain("Local Nine");
      expect(await readFile(sides.remotePath, "utf8")).toContain("Remote Nine");
    } finally {
      await state.remote.cleanup();
    }
  });

  it("fails as a curated-conflict error when the local side no longer exists", async () => {
    const state = await conflictedVault();
    try {
      await rm(path.join(state.vault.root, "specs/SPEC-9.md"));
      const nine = state.records.find((r: ConflictNoteRecord) => r.noteId === "SPEC-9")!;
      await expect(materializeConflictSides(state.deps, nine)).rejects.toMatchObject({
        code: "CONFLICT_CURATED",
        message: expect.stringContaining("specs/SPEC-9.md"),
      });
    } finally {
      await state.remote.cleanup();
    }
  });
});

describe("finalizeResolution", () => {
  it("integrates the remote, commits the merged note with the shared grammar, pushes, flips the note, retains the branch", async () => {
    const state = await conflictedVault();
    try {
      const nine = state.records.find((r: ConflictNoteRecord) => r.noteId === "SPEC-9")!;
      const originBefore = await revParse(state.vault.root, "@{upstream}");

      const result = await finalizeResolution(state.deps, nine, MERGED_NINE);

      // real path now holds the merged content
      expect(await readFile(path.join(state.vault.root, "specs/SPEC-9.md"), "utf8")).toContain(
        "Merged Nine",
      );
      // grammar: shared header + resolution suffix, as the tip commit
      const subjects = await lastSubjects(state.vault.root);
      expect(subjects[0]).toBe('note(update): spec "Merged Nine" [SPEC-9] (conflict resolved)');
      expect(subjects.some((s) => s.includes("(conflict resolved)"))).toBe(true);
      // human author — git blame shows people (design §4.3)
      expect(await lastAuthor(state.vault.root)).toBe("Jane Doe");
      // pushed: the remote-tracking ref moved to the new HEAD
      const originAfter = await revParse(state.vault.root, "@{upstream}");
      expect(originAfter).not.toBe(originBefore);
      expect(originAfter).toBe(await revParse(state.vault.root, "HEAD"));
      expect(result.commitSha).toBe(originAfter);
      // conflict note flipped on disk
      const note = await readFile(nine.path, "utf8");
      expect(note).toContain("status: resolved");
      expect(note).not.toContain("status: open");
      // snapshot branch retained (audit trail — never deleted in M1)
      const branches = await state.vault.git.raw([
        "branch",
        "--list",
        "conflict/20250601-1200-SPEC-9",
      ]);
      expect(branches).toContain("conflict/20250601-1200-SPEC-9");
      // the settle kept the LOCAL side in the replayed commit (never
      // silently delete): the local-edit commit still holds Local Nine
      const log = await state.vault.git.raw(["log", "--format=%H:%s"]);
      const localEdit = log
        .split("\n")
        .find((line) => line.includes("test: local-side edits on both specs"));
      expect(localEdit).toBeDefined();
      const localCommitSha = localEdit!.split(":")[0];
      const settledNine = await state.vault.git.raw([
        "show",
        `${localCommitSha}:specs/SPEC-9.md`,
      ]);
      expect(settledNine).toContain("Local Nine");
    } finally {
      await state.remote.cleanup();
    }
  });

  it("blocks on a flagged secret before anything is written, committed, or pushed", async () => {
    const state = await conflictedVault();
    try {
      const nine = state.records.find((r: ConflictNoteRecord) => r.noteId === "SPEC-9")!;
      const originBefore = await revParse(state.vault.root, "@{upstream}");
      const secreted = MERGED_NINE.replace("Body text.", "key = AKIAIOSFODNN7EXAMPLE");

      await expect(finalizeResolution(state.deps, nine, secreted)).rejects.toMatchObject({
        code: "SECRETS_BLOCKED",
      });

      expect(await readFile(path.join(state.vault.root, "specs/SPEC-9.md"), "utf8")).toContain(
        "Local Nine",
      );
      const subjects = await lastSubjects(state.vault.root);
      expect(subjects.some((s) => s.includes("(conflict resolved)"))).toBe(false);
      expect(await revParse(state.vault.root, "@{upstream}")).toBe(originBefore);
      const note = await readFile(nine.path, "utf8");
      expect(note).toContain("status: open");
    } finally {
      await state.remote.cleanup();
    }
  });
});

describe("runResolve", () => {
  it("resolves one conflict and skips the other on a declined merge, reporting both", async () => {
    const state = await conflictedVault();
    try {
      const prompt = scriptedPrompt((ctx) => (ctx.noteId === "SPEC-9" ? MERGED_NINE : null));
      const report = await runResolve({ ...state.deps, prompt });

      expect(report.outcomes).toHaveLength(2);
      const nine = report.outcomes.find((o: ResolveOutcome) => o.noteId === "SPEC-9");
      const ten = report.outcomes.find((o: ResolveOutcome) => o.noteId === "SPEC-10");
      expect(nine).toMatchObject({ result: "resolved", noteId: "SPEC-9" });
      expect(nine?.commitSha).toBeDefined();
      expect(ten).toMatchObject({ result: "skipped", noteId: "SPEC-10" });

      // the prompt saw both sides side by side, materialized next to the note
      const nineCall = prompt.calls.find((c) => c.noteId === "SPEC-9")!;
      expect(nineCall.notePath).toBe("specs/SPEC-9.md");
      expect(nineCall.localContent).toContain("Local Nine");
      expect(nineCall.remoteContent).toContain("Remote Nine");
      expect(nineCall.localPath).toBe(
        path.join(state.vault.root, "conflicts", "SPEC-9.local.md"),
      );
      expect(nineCall.remotePath).toBe(
        path.join(state.vault.root, "conflicts", "SPEC-9.remote.md"),
      );

      // resolved side: merged on disk, note flipped
      expect(await readFile(path.join(state.vault.root, "specs/SPEC-9.md"), "utf8")).toContain(
        "Merged Nine",
      );
      const nineNote = await readFile(
        path.join(state.vault.root, "conflicts", "20250601-1200-SPEC-9.md"),
        "utf8",
      );
      expect(nineNote).toContain("status: resolved");
      // skipped side: untouched, still open
      expect(await readFile(path.join(state.vault.root, "specs/SPEC-10.md"), "utf8")).toContain(
        "Local Ten",
      );
      const tenNote = await readFile(
        path.join(state.vault.root, "conflicts", "20250601-1200-SPEC-10.md"),
        "utf8",
      );
      expect(tenNote).toContain("status: open");
    } finally {
      await state.remote.cleanup();
    }
  });

  it("skips when the human merges but does not confirm the finalize", async () => {
    const state = await conflictedVault();
    try {
      const prompt = scriptedPrompt(() => MERGED_NINE, false);
      const report = await runResolve({ ...state.deps, prompt });

      expect(report.outcomes.every((o: ResolveOutcome) => o.result === "skipped")).toBe(true);
      expect(prompt.calls).toHaveLength(2); // both sides were presented
      expect(prompt.confirmCalls).toBe(2); // both were asked, both declined
      const note = await readFile(
        path.join(state.vault.root, "conflicts", "20250601-1200-SPEC-9.md"),
        "utf8",
      );
      expect(note).toContain("status: open");
      expect(await readFile(path.join(state.vault.root, "specs/SPEC-9.md"), "utf8")).toContain(
        "Local Nine",
      );
    } finally {
      await state.remote.cleanup();
    }
  });

  it("a blocked finalize fails its own conflict without stopping the rest", async () => {
    const state = await conflictedVault();
    try {
      const secreted = MERGED_NINE.replace("Body text.", "key = AKIAIOSFODNN7EXAMPLE");
      const prompt = scriptedPrompt((ctx) => (ctx.noteId === "SPEC-9" ? secreted : MERGED_TEN));
      const report = await runResolve({ ...state.deps, prompt });

      const nine = report.outcomes.find((o: ResolveOutcome) => o.noteId === "SPEC-9");
      const ten = report.outcomes.find((o: ResolveOutcome) => o.noteId === "SPEC-10");
      expect(nine).toMatchObject({ result: "failed", code: "SECRETS_BLOCKED" });
      expect(ten).toMatchObject({ result: "resolved", noteId: "SPEC-10" });
      // blocked side stays open and untouched
      const nineNote = await readFile(
        path.join(state.vault.root, "conflicts", "20250601-1200-SPEC-9.md"),
        "utf8",
      );
      expect(nineNote).toContain("status: open");
    } finally {
      await state.remote.cleanup();
    }
  });
});
