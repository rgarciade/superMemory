import { describe, expect, it, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createSyncEngine, type CycleReport, type SyncEngineDeps } from "../../src/sync/engine.js";
import { PidfileLock } from "../../src/sync/lock.js";
import { createGitClient } from "../../src/sync/git.js";
import {
  createEngineStateTracker,
  type EngineStateTracker,
} from "../../src/sync/state.js";
import type { WriteEvent, SyncPort } from "../../src/notes/save-pipeline.js";
import type { Clock } from "../../src/util/clock.js";
import type { IndexStore } from "../../src/index/store.js";
import { createStore } from "../../src/index/store.js";
import type { RulesModel } from "../../src/rules/types.js";
import type { SyncTunables } from "../../src/config/vault-config.js";
import { createTestVault } from "../helpers/create-test-vault.js";
import { createDivergentClones } from "../helpers/create-remote.js";
import { connectVaultToRemote, type RemoteVault } from "../helpers/remote-vault.js";
import { MemoryLockRegistry } from "../helpers/memory-lock-registry.js";
import { ManualTimerPort } from "../helpers/manual-timer-port.js";

// Task 3.8 [RED first]: engine.ts — runCycle(trigger) per design §4.1:
// lock → pre-pull format_version guard → commit pending writes (one
// commit per write event, secrets lint, human author) → pull --rebase
// --autostash → conflict ladder → union normalization → separate
// chore(index) regeneration → push (never force, capped exponential
// backoff via injected Clock/TimerPort) → post-sync rules reload hook.
// Named scenarios: autostash survival, pull-before-write, skip-clean
// interval, backoff without loss.

const NOW = new Date("2025-06-01T12:00:00.000Z");

class FixedClock implements Clock {
  now(): Date {
    return new Date(NOW);
  }
}

const AUTHOR = { name: "Jane Doe", email: "jane@example.com" };

function rulesModel(overrides: Partial<RulesModel> = {}): RulesModel {
  return {
    formatVersion: "1.0",
    noteTypes: {
      spec: { folder: "specs/", frontmatter: {}, conflictPolicy: "human_required" },
      session_log: { folder: "logs/", frontmatter: {}, conflictPolicy: "union" },
    },
    lifecycle: {},
    conflictPolicyDefaults: {},
    git: {},
    ...overrides,
  };
}

function specNote(id: string, title: string, status = "draft", body = "Body."): string {
  return `---\nspec_id: ${id}\nstatus: ${status}\nowner: team\n---\n\n# ${title}\n\n${body}\n`;
}

function writeEvent(overrides: Partial<WriteEvent> = {}): WriteEvent {
  return {
    op: "add",
    type: "spec",
    path: "specs/SPEC-1.md",
    via: "mcp:test",
    at: new Date(NOW),
    ...overrides,
  };
}

interface FakeIndexPort {
  port: SyncEngineDeps["index"];
  reparsed: string[][];
  setRegeneration(result: { changedPaths: string[]; noteCount: number }, write?: () => Promise<void>): void;
}

function fakeIndexPort(): FakeIndexPort {
  const reparsed: string[][] = [];
  let result: { changedPaths: string[]; noteCount: number } = { changedPaths: [], noteCount: 0 };
  let write: (() => Promise<void>) | undefined;
  return {
    reparsed,
    setRegeneration(next, writeFn) {
      result = next;
      write = writeFn;
    },
    port: {
      reparse: async (paths: string[]) => {
        reparsed.push(paths);
      },
      regenerateMaps: async () => {
        if (write) await write();
        return result;
      },
    },
  };
}

interface Harness {
  engine: ReturnType<typeof createSyncEngine>;
  index: FakeIndexPort;
  timers: ManualTimerPort;
  tracker: EngineStateTracker;
  rules: RulesModel;
}

function harness(
  vaultRoot: string,
  overrides: Partial<SyncEngineDeps> & { rules?: RulesModel } = {},
): Harness {
  const rules = overrides.rules ?? rulesModel();
  const store: IndexStore = createStore();
  const tracker =
    overrides.state ?? createEngineStateTracker({ rules, store, clock: new FixedClock() });
  const index = fakeIndexPort();
  const timers = new ManualTimerPort();
  const tunables: SyncTunables = { intervalMs: 900_000, debounceMs: 45_000 };
  const engine = createSyncEngine({
    vaultPath: vaultRoot,
    store,
    rules,
    tunables,
    clock: new FixedClock(),
    timer: timers,
    lock: new PidfileLock({ vaultRoot, storage: new MemoryLockRegistry(), pid: 424_242 }),
    git: createGitClient(vaultRoot),
    index: index.port,
    reloadRules: async () => rules,
    author: AUTHOR,
    state: tracker,
    ...overrides,
  });
  return { engine, index, timers, tracker, rules };
}

async function commitCount(vault: RemoteVault): Promise<number> {
  const out = await vault.vault.git.raw(["rev-list", "--count", "HEAD"]);
  return Number(out.trim());
}

/**
 * Pushes the vault's seeded commits to the origin, so a following
 * `diverge()` builds on a shared ancestor. Spec scenarios are "a note that
 * exists BOTH locally and on the remote, with the remote ahead" — without
 * this, the remote side ADDS the same file independently and the rebase
 * sees an add/add conflict, a different (pathological) history shape.
 */
async function publishSeed(rv: RemoteVault): Promise<void> {
  await rv.vault.git.raw(["push"]);
}

async function lastSubject(vaultRoot: string): Promise<string> {
  const { simpleGit } = await import("simple-git");
  return (await simpleGit(vaultRoot).raw(["log", "-1", "--format=%s"])).trim();
}

async function lastFullBody(vaultRoot: string): Promise<string> {
  const { simpleGit } = await import("simple-git");
  return (await simpleGit(vaultRoot).raw(["log", "-1", "--format=%B"])).trim();
}

async function lastAuthorName(vaultRoot: string): Promise<string> {
  const { simpleGit } = await import("simple-git");
  return (await simpleGit(vaultRoot).raw(["log", "-1", "--format=%an"])).trim();
}

describe("runCycle — lock (OD-4)", () => {
  it("reports ownership when a live other actor holds the lock and touches nothing", async () => {
    const vault = await createTestVault();
    try {
      const registry = new MemoryLockRegistry({
        pid: 999_999,
        owner: "server",
        acquiredAt: "2025-05-31T00:00:00.000Z",
      });
      const { engine } = harness(vault.root, {
        lock: new PidfileLock({ vaultRoot: vault.root, storage: registry, pid: 424_242, isPidAlive: () => true }),
      });
      const before = await connectCount(vault);

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("locked");
      expect(report.lockHolder).toEqual({ pid: 999_999, owner: "server" });
      expect(report.commits).toEqual([]);
      expect(await connectCount(vault)).toBe(before);
    } finally {
      await vault.cleanup();
    }
  });
});

// helper used only by the lock test above (avoids a remote for a no-op cycle)
async function connectCount(vault: Awaited<ReturnType<typeof createTestVault>>): Promise<number> {
  const out = await vault.git.raw(["rev-list", "--count", "HEAD"]);
  return Number(out.trim());
}

describe("runCycle — commits pending writes", () => {
  it("commits one journal write as note(add) with the human author and trailers, then pushes", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      await rv.vault.write("specs/SPEC-1.md", specNote("SPEC-1", "New Spec"));
      const { engine, tracker } = harness(rv.vault.root);
      engine.notifyWrite(writeEvent());
      expect(engine.state().pendingWrites).toBe(1);

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("synced");
      expect(report.pushed).toBe(true);
      expect(report.commits).toHaveLength(1);
      expect(await lastSubject(rv.vault.root)).toBe('note(add): spec "New Spec" [SPEC-1]');
      expect(await lastAuthorName(rv.vault.root)).toBe("Jane Doe");
      const body = await lastFullBody(rv.vault.root);
      expect(body).toContain("Author: Jane Doe");
      expect(body).toContain("Via: mcp:test");
      expect(body).toContain("Spec: SPEC-1");
      expect(engine.state().pendingWrites).toBe(0);
      expect(tracker.snapshot().lastSuccessfulSyncAt).toBe(NOW.toISOString());
    } finally {
      await rv.cleanup();
    }
  });

  it("blocks a write carrying a secret (SECRETS_BLOCKED), keeps it pending, pushes the clean ones", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      await rv.vault.write(
        "specs/SPEC-2.md",
        specNote("SPEC-2", "Leaky", "draft", "key AKIAIOSFODNN7EXAMPLE inside"),
      );
      await rv.vault.write("specs/SPEC-3.md", specNote("SPEC-3", "Clean"));
      const { engine } = harness(rv.vault.root);
      engine.notifyWrite(writeEvent({ path: "specs/SPEC-2.md" }));
      engine.notifyWrite(writeEvent({ path: "specs/SPEC-3.md" }));

      const report = await engine.runCycle("manual");

      expect(report.blocked).toHaveLength(1);
      expect(report.blocked[0]?.code).toBe("SECRETS_BLOCKED");
      expect(report.blocked[0]?.path).toBe("specs/SPEC-2.md");
      expect(report.outcome).toBe("secrets-blocked");
      // the clean sibling was committed and pushed; the secret never left
      expect(report.pushed).toBe(true);
      expect(await lastSubject(rv.vault.root)).toBe('note(add): spec "Clean" [SPEC-3]');
      expect(engine.state().pendingWrites).toBe(1);
      const stillThere = await readFile(path.join(rv.vault.root, "specs/SPEC-2.md"), "utf8");
      expect(stillThere).toContain("AKIAIOSFODNN7EXAMPLE");
    } finally {
      await rv.cleanup();
    }
  });

  it("commits human working-tree edits through the same derivation path (status suffix)", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      await rv.vault.write("specs/SPEC-1.md", specNote("SPEC-1", "Titled", "draft"));
      await rv.vault.commit("test: seed note");
      await rv.diverge("logs/unrelated.md", "- 2025-06-01T09:00:00.000Z | r1 | remote\n");
      await rv.vault.write("specs/SPEC-1.md", specNote("SPEC-1", "Titled", "active"));
      const { engine } = harness(rv.vault.root);

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("synced");
      expect(await lastSubject(rv.vault.root)).toBe(
        'note(update): spec "Titled" [SPEC-1] (status: draft→active)',
      );
      expect(await lastAuthorName(rv.vault.root)).toBe("Jane Doe");
    } finally {
      await rv.cleanup();
    }
  });

  it("commits a journal deletion derived from the HEAD version of the file", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      await rv.vault.write("specs/SPEC-9.md", specNote("SPEC-9", "Doomed"));
      await rv.vault.commit("test: seed doomed note");
      await rm(path.join(rv.vault.root, "specs/SPEC-9.md"), { force: true });
      const { engine } = harness(rv.vault.root);
      engine.notifyWrite(writeEvent({ op: "delete", path: "specs/SPEC-9.md", via: "mcp:test" }));

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("synced");
      expect(await lastSubject(rv.vault.root)).toBe('note(delete): spec "Doomed" [SPEC-9]');
    } finally {
      await rv.cleanup();
    }
  });
});

describe("runCycle — pull --rebase --autostash", () => {
  it("keeps uncommitted human work intact while integrating the remote (autostash survival)", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      await rv.vault.write("specs/SPEC-1.md", specNote("SPEC-1", "Base"));
      await rv.vault.commit("test: seed");
      await rv.diverge("logs/remote-log.md", "- 2025-06-01T09:00:00.000Z | r1 | remote entry\n");
      // uncommitted human edit, never committed
      await rv.vault.write("specs/SPEC-2.md", specNote("SPEC-2", "Human WIP"));
      const { engine } = harness(rv.vault.root);

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("synced");
      // remote content landed
      const pulled = await readFile(path.join(rv.vault.root, "logs/remote-log.md"), "utf8");
      expect(pulled).toContain("remote entry");
      // the uncommitted edit survived — committed with the human as author
      const wip = await readFile(path.join(rv.vault.root, "specs/SPEC-2.md"), "utf8");
      expect(wip).toContain("Human WIP");
      expect(await lastSubject(rv.vault.root)).toBe('note(add): spec "Human WIP" [SPEC-2]');
      expect(await lastAuthorName(rv.vault.root)).toBe("Jane Doe");
    } finally {
      await rv.cleanup();
    }
  });

  it("a blocked secret file stays UNCOMMITTED and survives the pull via autostash", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      await rv.vault.write("specs/SPEC-1.md", specNote("SPEC-1", "Base"));
      await rv.vault.commit("test: seed");
      await rv.diverge("logs/remote-log.md", "- 2025-06-01T09:00:00.000Z | r1 | remote entry\n");
      await rv.vault.write(
        "specs/SPEC-2.md",
        specNote("SPEC-2", "Leaky", "draft", "token ghp_0123456789abcdefghijklmnopqrstuvwxyz"),
      );
      const { engine } = harness(rv.vault.root);

      const report = await engine.runCycle("manual");

      expect(report.blocked).toHaveLength(1);
      const leaked = await readFile(path.join(rv.vault.root, "specs/SPEC-2.md"), "utf8");
      expect(leaked).toContain("ghp_0123456789abcdefghijklmnopqrstuvwxyz");
      const tracked = await rv.vault.git.raw(["status", "--porcelain"]);
      expect(tracked).toContain("specs/SPEC-2.md");
    } finally {
      await rv.cleanup();
    }
  });

  it("pulls the latest remote before a write lands (rebase-on-remote, reparse of pulled paths)", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      await rv.vault.write(
        "specs/SPEC-1.md",
        specNote("SPEC-1", "Shared", "draft", "First paragraph.\n"),
      );
      await rv.vault.commit("test: seed");
      await publishSeed(rv);
      await rv.diverge(
        "specs/SPEC-1.md",
        specNote("SPEC-1", "Shared", "draft", "First paragraph.\n\nRemote paragraph.\n"),
      );
      const { engine, index } = harness(rv.vault.root);
      engine.notifyWrite(
        writeEvent({
          op: "update",
          path: "specs/SPEC-1.md",
          via: "mcp:test",
        }),
      );
      // apply the agent's edit to disk (the save pipeline wrote it before notifyWrite)
      await rv.vault.write(
        "specs/SPEC-1.md",
        specNote("SPEC-1", "Shared", "active", "First paragraph.\n"),
      );

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("synced");
      // the write commit was REBASED onto the remote tip: remote commit below, write above
      const subjects = await rv.vault.git.raw(["log", "--format=%s", "-3"]);
      const lines = subjects.trim().split("\n");
      expect(lines[0]).toMatch(/^note\(update\): spec "Shared"/);
      expect(lines).toContain("test: divergent remote edit");
      // final content has BOTH the remote paragraph and the local status change
      const merged = await readFile(path.join(rv.vault.root, "specs/SPEC-1.md"), "utf8");
      expect(merged).toContain("Remote paragraph.");
      expect(merged).toContain("status: active");
      // the pulled diff's changed note paths went to the index port (OD-5)
      expect(index.reparsed).toEqual([["specs/SPEC-1.md"]]);
    } finally {
      await rv.cleanup();
    }
  });
});

describe("runCycle — skip-clean (interval)", () => {
  it("an interval tick on a clean, synced vault commits nothing and returns idle", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      const { engine } = harness(rv.vault.root);
      const before = await commitCount(rv);

      const report = await engine.runCycle("interval");

      expect(report.outcome).toBe("idle");
      expect(report.commits).toEqual([]);
      expect(report.pushed).toBe(false);
      expect(await commitCount(rv)).toBe(before);
    } finally {
      await rv.cleanup();
    }
  });
});

describe("runCycle — conflict ladder", () => {
  it("curated conflict: aborts, snapshots the incoming side, writes the conflict note, pauses push", async () => {
    const clones = await createDivergentClones({
      notePath: "specs/SPEC-9.md",
      baseContent: specNote("SPEC-9", "Shared Title"),
      localContent: specNote("SPEC-9", "Local Title"),
      remoteContent: specNote("SPEC-9", "Remote Title"),
    });
    try {
      const originBefore = await clones.local.git.raw(["rev-parse", "origin/main"]);
      const { engine, tracker } = harness(clones.local.root);

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("conflict");
      // local state intact (never silently delete)
      const local = await readFile(path.join(clones.local.root, "specs/SPEC-9.md"), "utf8");
      expect(local).toContain("Local Title");
      // snapshot branch holds the incoming (remote) side
      const branches = await clones.local.git.raw(["branch", "--list", "conflict/20250601-1200-SPEC-9"]);
      expect(branches).toContain("conflict/20250601-1200-SPEC-9");
      const snapshot = await clones.local.git.raw([
        "show",
        "conflict/20250601-1200-SPEC-9:specs/SPEC-9.md",
      ]);
      expect(snapshot).toContain("Remote Title");
      // conflict note visible in the vault, committed as chore(conflict)
      const notePath = path.join(
        clones.local.root,
        "conflicts",
        "20250601-1200-SPEC-9.md",
      );
      const note = await readFile(notePath, "utf8");
      expect(note).toContain("status: open");
      expect(note).toContain("snapshot_branch: conflict/20250601-1200-SPEC-9");
      expect(await lastSubject(clones.local.root)).toBe(
        "chore(conflict): record divergent edits for SPEC-9",
      );
      // push paused: nothing reached the remote
      expect(report.pushed).toBe(false);
      expect(tracker.snapshot().pushPaused).toBe(true);
      expect(tracker.snapshot().conflicts).toHaveLength(1);
      expect(tracker.snapshot().conflicts[0]?.noteId).toBe("SPEC-9");
      expect(await clones.local.git.raw(["rev-parse", "origin/main"])).toBe(originBefore);
    } finally {
      await clones.cleanup();
    }
  });

  it("generated conflicts resolve without a human and regeneration lands as its own chore(index) commit", async () => {
    const clones = await createDivergentClones({
      notePath: "gen/generated.md",
      baseContent: "shared line\n",
      localContent: "local line\n",
      remoteContent: "remote line\n",
    });
    try {
      const rules = rulesModel({
        noteTypes: {},
        git: { generatedPaths: ["gen/"] },
      });
      const { engine, index } = harness(clones.local.root, { rules });
      index.setRegeneration({ changedPaths: ["gen/generated.md"], noteCount: 2 }, async () => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path.join(clones.local.root, "gen/generated.md"), "regenerated maps\n", "utf8");
      });

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("synced");
      expect(report.pushed).toBe(true);
      // the rebase completed: the incoming side won, no conflicts remain
      const file = await readFile(path.join(clones.local.root, "gen/generated.md"), "utf8");
      expect(file).toBe("regenerated maps\n");
      // regeneration is its own commit, distinct from note commits
      const subjects = await clones.local.git.raw(["log", "--format=%s", "-3"]);
      expect(subjects).toContain("chore(index): regenerate maps (2 notes)");
      expect(report.commits).toHaveLength(2); // theirs + regen (local commit replayed, no new sha for it)
    } finally {
      await clones.cleanup();
    }
  });

  it("union log conflicts merge as a sorted, deduplicated union with a normalization commit", async () => {
    const clones = await createDivergentClones({
      notePath: "logs/session-2025-06-01.md",
      baseContent:
        "# Session\n\n- 2025-06-01T08:00:00.000Z | e2 | base two\n- 2025-06-01T07:00:00.000Z | e1 | base one\n",
      localContent:
        "# Session\n\n- 2025-06-01T08:00:00.000Z | e2 | base two\n- 2025-06-01T07:00:00.000Z | e1 | base one\n- 2025-06-01T10:00:00.000Z | e3 | local entry\n",
      remoteContent:
        "# Session\n\n- 2025-06-01T08:00:00.000Z | e2 | base two\n- 2025-06-01T07:00:00.000Z | e1 | base one\n- 2025-06-01T09:00:00.000Z | e0 | remote entry\n- 2025-06-01T10:00:00.000Z | e3 | local entry\n",
    });
    try {
      const { engine } = harness(clones.local.root);

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("synced");
      const log = await readFile(
        path.join(clones.local.root, "logs/session-2025-06-01.md"),
        "utf8",
      );
      const entries = log
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => l.split(" | ")[1]);
      expect(entries).toEqual(["e1", "e2", "e0", "e3"]);
      const subjects = await clones.local.git.raw(["log", "--format=%s", "-2"]);
      expect(subjects).toContain("chore(sync): normalize session logs");
    } finally {
      await clones.cleanup();
    }
  });
});

describe("runCycle — rules hooks (design §3.1)", () => {
  it("pre-pull guard: unsupported remote format_version skips the pull, keeps the write pending, refuses", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      const remoteRules = await readFile(path.join(rv.vault.root, ".memory/rules.md"), "utf8");
      await rv.diverge(
        ".memory/rules.md",
        remoteRules.replace("format_version: 1.0", "format_version: 2.0"),
      );
      await rv.vault.write("specs/SPEC-1.md", specNote("SPEC-1", "Pending"));
      const reload = vi.fn(async () => rulesModel());
      const { engine } = harness(rv.vault.root, { reloadRules: reload });
      engine.notifyWrite(writeEvent({ path: "specs/SPEC-1.md" }));

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("rules-refused");
      expect(report.error?.code).toBe("FORMAT_VERSION_UNSUPPORTED");
      expect(report.pushed).toBe(false);
      // the pull never happened: pending write NOT committed, rules.md untouched
      expect(engine.state().pendingWrites).toBe(1);
      const rulesOnDisk = await readFile(path.join(rv.vault.root, ".memory/rules.md"), "utf8");
      expect(rulesOnDisk).toContain("format_version: 1.0");
      expect(reload).not.toHaveBeenCalled();
    } finally {
      await rv.cleanup();
    }
  });

  it("recovery: once the remote speaks the supported major again, the cycle proceeds", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      const remoteRules = await readFile(path.join(rv.vault.root, ".memory/rules.md"), "utf8");
      await rv.diverge(
        ".memory/rules.md",
        remoteRules.replace("format_version: 1.0", "format_version: 2.0"),
      );
      await rv.vault.write("specs/SPEC-1.md", specNote("SPEC-1", "Pending"));
      const { engine } = harness(rv.vault.root);
      engine.notifyWrite(writeEvent({ path: "specs/SPEC-1.md" }));
      await engine.runCycle("manual");
      expect(engine.state().pendingWrites).toBe(1);

      await rv.diverge(".memory/rules.md", remoteRules);
      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("synced");
      expect(engine.state().pendingWrites).toBe(0);
      expect(engine.state().pushPaused).toBe(false);
    } finally {
      await rv.cleanup();
    }
  });

  it("post-sync hook success: a pulled rules.md triggers rules-reloaded with the new model", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      const remoteRules = await readFile(path.join(rv.vault.root, ".memory/rules.md"), "utf8");
      await rv.diverge(
        ".memory/rules.md",
        remoteRules.replace("format_version: 1.0", "format_version: 1.1"),
      );
      const rules2 = rulesModel({ formatVersion: "1.1" });
      const resolveTunables = vi.fn(
        (_rules: RulesModel): SyncTunables => ({ intervalMs: 1, debounceMs: 2 }),
      );
      const reloaded: RulesModel[] = [];
      const { engine } = harness(rv.vault.root, {
        reloadRules: async () => rules2,
        resolveTunables,
        onRulesReloaded: (next: RulesModel) => {
          reloaded.push(next);
        },
      });

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("synced");
      expect(reloaded).toEqual([rules2]);
      expect(engine.state().formatVersion).toBe("1.1");
      expect(resolveTunables).toHaveBeenCalledWith(rules2);
    } finally {
      await rv.cleanup();
    }
  });

  it("post-sync hook refusal (human local rules edit): halts commits/push and reports refused", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      const originBefore = await rv.vault.git.raw(["rev-parse", "@{upstream}"]);
      const rulesOnDisk = await readFile(path.join(rv.vault.root, ".memory/rules.md"), "utf8");
      await rv.vault.write(
        ".memory/rules.md",
        rulesOnDisk.replace("format_version: 1.0", "format_version: 2.0"),
      );
      const { engine } = harness(rv.vault.root, {
        reloadRules: async () => {
          throw new Error("FORMAT_VERSION_UNSUPPORTED: vault requires format 2.x");
        },
      });

      const report = await engine.runCycle("manual");

      expect(report.outcome).toBe("rules-refused");
      // the human rules edit WAS committed locally, but the push was halted
      expect(report.commits).toHaveLength(1);
      expect(report.pushed).toBe(false);
      expect(await rv.vault.git.raw(["rev-parse", "@{upstream}"])).toBe(originBefore);
      expect(engine.state().pushPaused).toBe(true);
    } finally {
      await rv.cleanup();
    }
  });
});

describe("runCycle — push backoff (never force, never lose)", () => {
  it("retries a failing push with capped exponential backoff; local writes stay intact; last success kept", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      await rv.vault.write("specs/SPEC-1.md", specNote("SPEC-1", "Offline"));
      const realGit = createGitClient(rv.vault.root);
      let pushes = 0;
      const git = {
        ...realGit,
        push: async () => {
          pushes += 1;
          throw new Error("Could not read from remote repository.");
        },
      };
      const earlier = new Date("2025-05-31T00:00:00.000Z");
      const tracker = createEngineStateTracker({
        rules: rulesModel(),
        store: createStore(),
        clock: new FixedClock(),
      });
      tracker.setLastSuccessfulSync(earlier);
      const { engine, timers } = harness(rv.vault.root, { git, state: tracker } as Partial<SyncEngineDeps>);
      engine.notifyWrite(writeEvent({ path: "specs/SPEC-1.md" }));

      const cycle = engine.runCycle("manual");
      await timers.drainUntil(cycle);
      const report: CycleReport = await cycle;

      expect(report.outcome).toBe("push-failed");
      expect(report.pushed).toBe(false);
      expect(pushes).toBe(4); // initial attempt + 3 retries
      expect(timers.oneShotDelays()).toEqual([1_000, 2_000, 4_000]); // capped exponential
      // local writes intact
      expect(await lastSubject(rv.vault.root)).toBe('note(add): spec "Offline" [SPEC-1]');
      // status keeps the last successful sync
      expect(tracker.snapshot().lastSuccessfulSyncAt).toBe(earlier.toISOString());
    } finally {
      await rv.cleanup();
    }
  });

  it("a push that fails once then succeeds retries once and records the success", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      await rv.vault.write("specs/SPEC-1.md", specNote("SPEC-1", "Flaky"));
      const realGit = createGitClient(rv.vault.root);
      let pushes = 0;
      const git = {
        ...realGit,
        push: async () => {
          pushes += 1;
          if (pushes === 1) throw new Error("network flake");
        },
      };
      const { engine, timers, tracker } = harness(rv.vault.root, { git } as Partial<SyncEngineDeps>);
      engine.notifyWrite(writeEvent({ path: "specs/SPEC-1.md" }));

      const cycle = engine.runCycle("manual");
      await timers.drainUntil(cycle);
      const report = await cycle;

      expect(report.outcome).toBe("synced");
      expect(report.pushed).toBe(true);
      expect(pushes).toBe(2);
      expect(timers.oneShotDelays()).toEqual([1_000]);
      expect(tracker.snapshot().lastSuccessfulSyncAt).toBe(NOW.toISOString());
    } finally {
      await rv.cleanup();
    }
  });
});

describe("pullLatest — the SyncPort seam (wired in task 3.13)", () => {
  it("pulls the remote tip, ladders if needed, and reparses the pulled paths", async () => {
    const rv = await connectVaultToRemote(await createTestVault());
    try {
      await rv.vault.write("specs/SPEC-1.md", specNote("SPEC-1", "Base"));
      await rv.vault.commit("test: seed");
      await publishSeed(rv);
      await rv.diverge(
        "specs/SPEC-1.md",
        specNote("SPEC-1", "Base", "draft", "Body.\n\nRemote paragraph.\n"),
      );
      const { engine, index } = harness(rv.vault.root);

      // the engine structurally satisfies the save pipeline's SyncPort
      const port: SyncPort = engine;
      await port.pullLatest();

      const merged = await readFile(path.join(rv.vault.root, "specs/SPEC-1.md"), "utf8");
      expect(merged).toContain("Remote paragraph.");
      expect(index.reparsed).toEqual([["specs/SPEC-1.md"]]);
    } finally {
      await rv.cleanup();
    }
  });
});

describe("engine state surface", () => {
  it("notifyWrite updates the pending-write count visible in the state snapshot", async () => {
    const vault = await createTestVault();
    try {
      const { engine } = harness(vault.root);
      expect(engine.state().pendingWrites).toBe(0);
      engine.notifyWrite(writeEvent());
      engine.notifyWrite(writeEvent({ path: "specs/SPEC-2.md" }));
      expect(engine.state().pendingWrites).toBe(2);
      expect(engine.pendingWriteCount()).toBe(2);
    } finally {
      await vault.cleanup();
    }
  });
});
