import { describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { simpleGit } from "simple-git";
import { createSyncEngine } from "../../src/sync/engine.js";
import { PidfileLock, SYNC_LOCK_FILE_NAME } from "../../src/sync/lock.js";
import { createGitClient } from "../../src/sync/git.js";
import { parseRules } from "../../src/rules/parser.js";
import { runResolveCommand } from "../../src/cli/commands/resolve.js";
import { runSyncCommand } from "../../src/cli/commands/sync.js";
import { createServer, createVaultSyncStack } from "../../src/mcp/server.js";
import type { RulesModel } from "../../src/rules/types.js";
import type { SyncTunables } from "../../src/config/vault-config.js";
import type { Clock } from "../../src/util/clock.js";
import type { EnvSource } from "../../src/config/env.js";
import type { MergePromptContext, ResolvePromptPort } from "../../src/sync/resolve.js";
import { createTestVault, type TestVault } from "../helpers/create-test-vault.js";
import { connectVaultToRemote, type RemoteVault } from "../helpers/remote-vault.js";
import { MemoryLockRegistry } from "../helpers/memory-lock-registry.js";
import { ManualTimerPort } from "../helpers/manual-timer-port.js";

// Load-sensitive real-git timeouts under parallel workers (add-m1-core verify finding #3).
vi.setConfig({ testTimeout: 20_000 });

// P3 phase gate (task 3.14) — the named end-to-end scenarios over the
// REAL modules (real git over hermetic local bare remotes, real engine,
// real CLI commands, real composed server over InMemoryTransport; the
// only fakes are the clock/timers, the lock storage where noted, and
// the resolve prompt):
//
//   1. HEADLINE never-delete: divergent clones ⇒ rebase aborted with
//      local state intact, remote recoverable from the snapshot branch,
//      conflict note visible in the vault, `resolve` completes, and
//      `status` clears.
//   2. Secrets blocked on EVERY trigger (debounce, interval, tool, CLI).
//   3. Lock single-owner / stale reclaim in a server-vs-CLI scenario.
//   4. Full hermetic M1 loop: boot → save → debounce → cycle → find.
//
// `npm test`, `npm run typecheck`, `npm run build` are the process
// gates recorded in apply-progress.md, not vitest assertions. No test
// here pushes from the agent shell — every push happens INSIDE the
// test process against local tmp bare remotes.

const NOW = new Date("2025-06-01T12:00:00.000Z");

class FixedClock implements Clock {
  now(): Date {
    return new Date(NOW);
  }
}

const AUTHOR = { name: "Jane Doe", email: "jane@example.com" };
const TUNABLES: SyncTunables = { intervalMs: 900_000, debounceMs: 45_000 };
const NO_ENV: EnvSource = { get: () => undefined };

/** The vault's REAL rules (fixture) — anything through the tool catalog validates against them. */
async function loadVaultRules(vaultRoot: string): Promise<RulesModel> {
  const raw = await readFile(path.join(vaultRoot, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

function rulesModel(): RulesModel {
  return {
    formatVersion: "1.0",
    noteTypes: {
      spec: { folder: "specs/", frontmatter: {}, conflictPolicy: "human_required" },
      decision: { folder: "decisions/", frontmatter: {}, conflictPolicy: "human_required" },
      session_log: { folder: "logs/", frontmatter: {}, conflictPolicy: "union" },
    },
    lifecycle: {},
    conflictPolicyDefaults: {},
    git: {},
  };
}

function specNote(id: string, title: string): string {
  return `---\nspec_id: ${id}\nstatus: draft\nowner: team\n---\n\n# ${title}\n\nBody text.\n`;
}

function scriptedPrompt(
  merge: (ctx: MergePromptContext) => string | null,
  confirm = true,
): ResolvePromptPort {
  return {
    mergeSides: async (ctx) => merge(ctx),
    confirmFinalize: async () => confirm,
  };
}

async function bareTip(remoteUrl: string): Promise<string> {
  return (await simpleGit(remoteUrl).raw(["rev-parse", "HEAD"])).trim();
}

async function headSubject(root: string): Promise<string> {
  return (await simpleGit(root).raw(["log", "--format=%s", "-1"])).trim();
}

/** A genuinely live foreign pid (a sleeping child) for lock-holder scenarios. */
function spawnLiveSleeper(): ChildProcess {
  return spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"]);
}

/** A genuinely dead pid (spawn, reap, return its pid). */
async function spawnDeadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  await once(child, "exit");
  return child.pid ?? -1;
}

interface EngineFixture {
  vault: TestVault;
  remote: RemoteVault;
  engine: ReturnType<typeof createSyncEngine>;
}

/**
 * A real engine over a vault wired to a hermetic bare remote — the
 * full production module set with only clock/timer/lock-storage fakes.
 */
async function engineFixture(
  seedNotes: Array<{ path: string; content: string }>,
): Promise<EngineFixture> {
  const vault = await createTestVault({ seedNotes });
  const remote = await connectVaultToRemote(vault);
  const rules = rulesModel();
  const engine = createSyncEngine({
    vaultPath: vault.root,
    store: createEngineTrackerStore(),
    rules,
    tunables: TUNABLES,
    clock: new FixedClock(),
    timer: new ManualTimerPort(),
    lock: new PidfileLock({
      vaultRoot: vault.root,
      storage: new MemoryLockRegistry(),
      pid: 424_242,
    }),
    git: createGitClient(vault.root),
    index: { reparse: async () => {}, regenerateMaps: async () => ({ changedPaths: [], noteCount: 0 }) },
    reloadRules: async () => rules,
    author: AUTHOR,
  });
  return { vault, remote, engine };
}

// The engine's tracker wants an IndexStore; gate tests don't inspect
// staleness, so an empty store module import is avoided via a dynamic
// indirection here (keeps the import list honest about what's faked).
import { createStore } from "../../src/index/store.js";
function createEngineTrackerStore() {
  return createStore();
}

describe("P3 gate — headline: divergent curated edits lose nothing and resolve cleanly", () => {
  it(
    "aborts with local state intact, snapshots the remote side, surfaces the conflict note, resolves, and clears status",
    async () => {
      const { vault, remote, engine } = await engineFixture([
        { path: "specs/SPEC-9.md", content: specNote("SPEC-9", "Base Nine") },
      ]);
      try {
        // Diverge: remote moves ahead, local edits the same note region.
        await remote.diverge("specs/SPEC-9.md", specNote("SPEC-9", "Remote Nine"));
        await vault.write("specs/SPEC-9.md", specNote("SPEC-9", "Local Nine"));
        await vault.commit("test: local-side edit");
        const bareTipBefore = await bareTip(remote.remoteUrl);

        // The cycle hits the curated conflict: abort + snapshot + note.
        const report = await engine.runCycle("manual");
        expect(report.outcome).toBe("conflict");

        // 1. Local state intact — the local version remains in the vault.
        const localOnDisk = await readFile(path.join(vault.root, "specs/SPEC-9.md"), "utf8");
        expect(localOnDisk).toContain("Local Nine");

        // 2. The remote version is recoverable from the snapshot branch.
        const conflictBranch = report.conflicts[0]?.snapshotBranch;
        expect(conflictBranch).toMatch(/^conflict\//);
        const snapGit = createGitClient(vault.root);
        const remoteSide = await snapGit.showFile(conflictBranch as string, "specs/SPEC-9.md");
        expect(remoteSide).toContain("Remote Nine");

        // 3. The conflict note is visible in the vault itself.
        const noteName = report.conflicts[0]?.conflictNotePath as string;
        const conflictNoteRaw = await readFile(noteName, "utf8");
        expect(conflictNoteRaw).toContain("status: open");
        expect(conflictNoteRaw).toContain("supermemory resolve");

        // 4. `resolve` completes: merged, committed, pushed, note flipped.
        const bareTipAfterConflict = await bareTip(remote.remoteUrl);
        expect(bareTipAfterConflict).toBe(bareTipBefore); // push was paused
        const lines: string[] = [];
        await runResolveCommand({
          vaultFlag: vault.root,
          basePath: vault.root,
          out: (line: string) => lines.push(line),
          prompt: scriptedPrompt(() => specNote("SPEC-9", "Merged Nine")),
        });
        expect(lines.join("\n")).toMatch(/resolved/);
        const mergedOnDisk = await readFile(path.join(vault.root, "specs/SPEC-9.md"), "utf8");
        expect(mergedOnDisk).toContain("Merged Nine");
        expect(await bareTip(remote.remoteUrl)).not.toBe(bareTipAfterConflict);
        expect(await headSubject(vault.root)).toMatch(/conflict resolved/);

        // 5. `status` clears: the next cycle reconciles the durable
        // record (the flipped conflict note) — no conflict reported,
        // push resumed, state clean.
        const next = await engine.runCycle("manual");
        expect(next.outcome).toBe("synced");
        expect(next.pushed).toBe(true);
        const state = engine.state();
        expect(state.conflicts).toEqual([]);
        expect(state.pushPaused).toBe(false);
      } finally {
        await remote.cleanup();
      }
    },
    30_000,
  );
});

describe("P3 gate — secrets blocked on every trigger", () => {
  const SECRET_BODY = "key = AKIAIOSFODNN7EXAMPLE";

  it("blocks a pending write on the debounce trigger and keeps it pending", async () => {
    const { vault, remote, engine } = await engineFixture([
      { path: "specs/SPEC-1.md", content: specNote("SPEC-1", "Base") },
    ]);
    try {
      const before = await bareTip(remote.remoteUrl);
      // PENDING (uncommitted) — the engine's human-change path must lint
      // it BEFORE committing (a secret already in history is not a sync
      // write; the spec's scenario is a pending write).
      await vault.write(
        "specs/SPEC-1.md",
        specNote("SPEC-1", "Leaky").replace("Body text.", SECRET_BODY),
      );

      const report = await engine.runCycle("debounce");
      expect(report.blocked).toHaveLength(1);
      expect(report.blocked[0]?.code).toBe("SECRETS_BLOCKED");
      expect(report.blocked[0]?.path).toBe("specs/SPEC-1.md");
      expect(await bareTip(remote.remoteUrl)).toBe(before);
      expect(await headSubject(vault.root)).not.toMatch(/SPEC-1/);
    } finally {
      await remote.cleanup();
    }
  }, 20_000);

  it("blocks on the interval trigger and pushes nothing", async () => {
    const { vault, remote, engine } = await engineFixture([
      { path: "specs/SPEC-1.md", content: specNote("SPEC-1", "Base") },
    ]);
    try {
      const before = await bareTip(remote.remoteUrl);
      await vault.write(
        "specs/SPEC-1.md",
        specNote("SPEC-1", "Leaky").replace("Body text.", SECRET_BODY),
      );

      const report = await engine.runCycle("interval");
      expect(report.outcome).toBe("secrets-blocked");
      expect(report.blocked.map((b) => b.path)).toContain("specs/SPEC-1.md");
      expect(await bareTip(remote.remoteUrl)).toBe(before);
    } finally {
      await remote.cleanup();
    }
  }, 20_000);

  it("blocks on the CLI manual trigger, reports the file, and exits nonzero", async () => {
    const { vault, remote } = await engineFixture([
      { path: "specs/SPEC-1.md", content: specNote("SPEC-1", "Base") },
    ]);
    try {
      const before = await bareTip(remote.remoteUrl);
      await vault.write(
        "specs/SPEC-1.md",
        specNote("SPEC-1", "Leaky").replace("Body text.", SECRET_BODY),
      );
      // The fixture engine's cycle already ran; the CLI boots its OWN
      // engine (that is the trigger under test).
      const lines: string[] = [];
      await expect(
        runSyncCommand({ vaultFlag: vault.root, basePath: vault.root, out: (line: string) => lines.push(line) }),
      ).rejects.toMatchObject({ code: "SECRETS_BLOCKED" });
      expect(lines.join("\n")).toMatch(/SECRETS_BLOCKED specs\/SPEC-1\.md/);
      // The blocked write never committed: no note-grammar commit landed
      // on the remote (the CLI's real index port may still push its own
      // separate chore(index) regeneration commit — that is by design).
      const newSubjects = (
        await simpleGit(vault.root).raw(["log", "--format=%s", `${before}..HEAD`])
      ).split("\n").filter((line) => line !== "");
      expect(newSubjects.some((s) => s.startsWith("note("))).toBe(false);
      // And the secret itself never reached the remote.
      const remoteSpec = (
        await simpleGit(remote.remoteUrl).raw(["show", `HEAD:specs/SPEC-1.md`])
      );
      expect(remoteSpec).not.toContain(SECRET_BODY);
    } finally {
      await remote.cleanup();
    }
  }, 20_000);

  it("blocks on the MCP sync-tool trigger: error result names the file, nothing pushed", async () => {
    const { vault, remote, engine } = await engineFixture([
      { path: "specs/SPEC-1.md", content: specNote("SPEC-1", "Base") },
    ]);
    try {
      const before = await bareTip(remote.remoteUrl);
      // The tool catalog validates against the vault's REAL rules.
      const rules = await loadVaultRules(vault.root);
      const server = createServer({
        vaultPath: vault.root,
        rules,
        store: createEngineTrackerStore(),
        clock: new FixedClock(),
        templates: {},
        engine,
      });
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "p3-gate", version: "0.0.0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      try {
        // The writer saves a secret through the tool (the write lands in
        // the vault), then triggers sync through the tool.
        const saved = await client.callTool({
          name: "save",
          arguments: {
            type: "decision",
            decision_id: "DEC-77",
            spec_id: "SPEC-1",
            content: SECRET_BODY,
          },
        });
        expect(saved.isError).toBeFalsy();

        const result = await client.callTool({ name: "sync", arguments: {} });
        // The blockage is reported to the writer in the tool result.
        expect(result.isError).toBe(true);
        const contents = result.content as Array<{ type: string; text: string }>;
        const text = contents[0]?.text ?? "";
        expect(text).toContain("SECRETS_BLOCKED");
        expect(text).toContain("DEC-77");
        // The secret never reached the remote.
        expect(await bareTip(remote.remoteUrl)).toBe(before);
        // The write stays pending so the writer can remediate.
        expect(engine.pendingWriteCount()).toBe(1);
      } finally {
        await client.close();
        await server.close();
      }
    } finally {
      await remote.cleanup();
    }
  }, 20_000);
});

describe("P3 gate — lock single-owner/stale in a server-vs-CLI scenario", () => {
  it("the CLI reports ownership while the server holds the lock, and mutates nothing", async () => {
    const { vault, remote } = await engineFixture([
      { path: "specs/SPEC-1.md", content: specNote("SPEC-1", "Base") },
    ]);
    const holder = spawnLiveSleeper();
    try {
      await vault.write("specs/SPEC-1.md", specNote("SPEC-1", "Pending"));
      await vault.commit("test: pending write");
      const before = await bareTip(remote.remoteUrl);

      // The "server" holds the vault's REAL pidfile lock (live pid).
      const serverLock = new PidfileLock({ vaultRoot: vault.root, pid: holder.pid });
      const handle = await serverLock.acquire("server");
      expect(handle).not.toBeNull();

      const lines: string[] = [];
      await expect(
        runSyncCommand({ vaultFlag: vault.root, basePath: vault.root, out: (line: string) => lines.push(line) }),
      ).rejects.toMatchObject({ code: "LOCK_HELD" });
      expect(lines.join("\n")).toMatch(/sync outcome: locked/);
      expect(lines.join("\n")).toMatch(String(holder.pid));
      // No two engines raced: the remote never moved, the write stayed pending.
      expect(await bareTip(remote.remoteUrl)).toBe(before);
      await handle?.release();
    } finally {
      holder.kill();
      await remote.cleanup();
    }
  }, 20_000);

  it("a stale (dead-pid) lock is reclaimed: the CLI sync proceeds", async () => {
    const { vault, remote } = await engineFixture([
      { path: "specs/SPEC-1.md", content: specNote("SPEC-1", "Base") },
    ]);
    try {
      await vault.write("specs/SPEC-1.md", specNote("SPEC-1", "Pending"));
      await vault.commit("test: pending write");
      const before = await bareTip(remote.remoteUrl);

      // A dead actor's pidfile is left behind (crashed process).
      const deadPid = await spawnDeadPid();
      const lockPath = path.join(vault.root, ".memory", "cache", SYNC_LOCK_FILE_NAME);
      await mkdir(path.dirname(lockPath), { recursive: true });
      await writeFile(
        lockPath,
        `${JSON.stringify({ pid: deadPid, owner: "server", acquiredAt: NOW.toISOString() }, null, 2)}\n`,
        "utf8",
      );

      const lines: string[] = [];
      await runSyncCommand({ vaultFlag: vault.root, basePath: vault.root, out: (line: string) => lines.push(line) });
      expect(lines.join("\n")).toMatch(/sync outcome: synced/);
      expect(await bareTip(remote.remoteUrl)).not.toBe(before);
    } finally {
      await remote.cleanup();
    }
  }, 20_000);
});

describe("P3 gate — full hermetic M1 loop (boot → save → debounce → cycle → find)", () => {
  it(
    "saves through the MCP tool, debounces through the real scheduler, syncs to the bare remote, and finds the note",
    async () => {
      const vault = await createTestVault({
        seedNotes: [{ path: "specs/SPEC-1.md", content: specNote("SPEC-1", "Base") }],
      });
      const remote = await connectVaultToRemote(vault);
      // Fake timers only for the BOOT+LOOP portion: simple-git defers its
      // tasks via setTimeout, so the real-git fixture setup above must
      // never run under the fake clock (it would hang forever).
      vi.useFakeTimers();
      try {
        // BOOT — exactly the serveVault composition, minus stdio, over
        // the vault's REAL rules (the tool catalog validates with them).
        const rules = await loadVaultRules(vault.root);
        const store = createEngineTrackerStore();
        const clock = new FixedClock();
        const { engine, scheduler } = await createVaultSyncStack({
          vaultPath: vault.root,
          rules,
          store,
          clock,
          env: NO_ENV,
          author: AUTHOR,
          owner: "server",
        });
        const server = createServer({
          vaultPath: vault.root,
          rules,
          store,
          clock,
          templates: {},
          engine: {
            ...engine,
            notifyWrite: (event) => {
              engine.notifyWrite(event);
              scheduler.notifyWrite();
            },
          },
        });
        scheduler.start();
        const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "p3-gate-loop", version: "0.0.0" });
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

        // SAVE through the MCP tool.
        const saved = await client.callTool({
          name: "save",
          arguments: {
            type: "decision",
            decision_id: "DEC-50",
            spec_id: "SPEC-1",
            content: "the full M1 loop body",
          },
        });
        expect(saved.isError).toBeFalsy();

        // FIND before any cycle: the save is immediately visible.
        const before = await client.callTool({ name: "find", arguments: { free_text: "M1 loop body" } });
        const beforePayload = before.structuredContent as { results: Array<{ id: string }> };
        expect(beforePayload.results.map((r) => r.id)).toContain("DEC-50");

        // DEBOUNCE → CYCLE: the real scheduler fires runCycle('debounce')
        // after 45 s; the engine commits with the grammar and pushes to
        // the bare remote. Poll (bounded) until the remote tip moves.
        const tipBeforeSync = await bareTip(remote.remoteUrl);
        for (let i = 0; i < 200; i += 1) {
          await vi.advanceTimersByTimeAsync(1_000);
          if ((await bareTip(remote.remoteUrl)) !== tipBeforeSync) break;
        }
        expect(await bareTip(remote.remoteUrl)).not.toBe(tipBeforeSync);
        // The cycle lands the note commit AND its own separate
        // chore(index) regeneration commit (real index port), so assert
        // the log contains the grammar header — HEAD is the chore commit.
        const subjects = (
          await simpleGit(vault.root).raw(["log", "--format=%s"])
        ).split("\n").filter((line) => line !== "");
        expect(subjects.some((s) => /^note\(add\): decision ".*" \[DEC-50\]$/.test(s))).toBe(true);
        expect(subjects.some((s) => /^chore\(index\): regenerate maps/.test(s))).toBe(true);

        // STATUS: the cycle recorded a successful sync.
        const status = await client.callTool({ name: "status", arguments: {} });
        const statusPayload = status.structuredContent as { lastSuccessfulSyncAt: string | null };
        expect(statusPayload.lastSuccessfulSyncAt).not.toBeNull();

        // FIND after the cycle: still visible, deterministically ordered.
        const after = await client.callTool({ name: "find", arguments: { type: "decision" } });
        const afterPayload = after.structuredContent as { results: Array<{ id: string }> };
        expect(afterPayload.results.map((r) => r.id)).toContain("DEC-50");

        await client.close();
        await server.close();
        scheduler.stop();
      } finally {
        vi.useRealTimers();
        await remote.cleanup();
      }
    },
    30_000,
  );
});
