import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { simpleGit } from "simple-git";
import { AppError } from "../../../src/util/errors.js";
import { PidfileLock } from "../../../src/sync/lock.js";
import { createGitClient } from "../../../src/sync/git.js";
import { createSyncEngine } from "../../../src/sync/engine.js";
import type { RulesModel } from "../../../src/rules/types.js";
import type { SyncTunables } from "../../../src/config/vault-config.js";
import type { Clock } from "../../../src/util/clock.js";
import {
  registerResolveCommand,
  runResolveCommand,
} from "../../../src/cli/commands/resolve.js";
import type { MergePromptContext, ResolvePromptPort } from "../../../src/sync/resolve.js";
import { createTestVault, type TestVault } from "../../helpers/create-test-vault.js";
import { connectVaultToRemote, type RemoteVault } from "../../helpers/remote-vault.js";
import { makeProjectDir } from "../../helpers/project.js";
import { MemoryLockRegistry } from "../../helpers/memory-lock-registry.js";
import { ManualTimerPort } from "../../helpers/manual-timer-port.js";

// Load-sensitive real-git timeouts under parallel workers (add-m1-core verify finding #3).
vi.setConfig({ testTimeout: 20_000 });

// Task 3.12 [RED first]: `supermemory resolve` — the CLI entry for the
// guided flow (3.10, design §4.4 step 5). The command binds the REAL
// terminal prompt port at the edge (@inquirer/prompts, exactly like
// setup), acquires the sync lock per invocation (design §4.5: the
// server's engine holds it for its lifetime; the CLI reports ownership
// when held), runs `runResolve`, prints per-conflict outcomes, and maps
// failures to the AppError → exit-code contract.

const NOW = new Date("2025-06-01T12:00:00.000Z");

class FixedClock implements Clock {
  now(): Date {
    return new Date(NOW);
  }
}

const AUTHOR = { name: "Jane Doe", email: "jane@example.com" };
const TUNABLES: SyncTunables = { intervalMs: 900_000, debounceMs: 45_000 };

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

/** The vault's single conflict note (the fixture always creates exactly one). */
async function conflictNotePath(vault: TestVault): Promise<string> {
  const listed = (
    await simpleGit(vault.root).raw(["ls-files", "conflicts/"])
  ).split("\n").map((line) => line.trim()).filter((line) => line.endsWith(".md"));
  if (listed.length !== 1) throw new Error(`expected one conflict note, got ${listed.join(", ")}`);
  return path.join(vault.root, listed[0] ?? "");
}

interface ConflictedFixture {
  vault: TestVault;
  remote: RemoteVault;
}

/** The real engine produces the divergent-edit conflict the CLI walks into. */
async function conflictedVault(): Promise<ConflictedFixture> {
  const vault = await createTestVault({
    seedNotes: [{ path: "specs/SPEC-9.md", content: specNote("SPEC-9", "Base Nine") }],
  });
  const remote = await connectVaultToRemote(vault);
  await remote.diverge("specs/SPEC-9.md", specNote("SPEC-9", "Remote Nine"));
  await vault.write("specs/SPEC-9.md", specNote("SPEC-9", "Local Nine"));
  await vault.commit("test: local-side edit");
  const rules = rulesModel();
  const engine = createSyncEngine({
    vaultPath: vault.root,
    store: (await import("../../../src/index/store.js")).createStore(),
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
    index: {
      reparse: async () => {},
      regenerateMaps: async () => ({ changedPaths: [], noteCount: 1 }),
    },
    reloadRules: async () => rules,
    author: AUTHOR,
  });
  const report = await engine.runCycle("manual");
  if (report.outcome !== "conflict") {
    throw new Error(`fixture expected a curated conflict, got ${report.outcome}`);
  }
  return { vault, remote };
}

describe("registerResolveCommand", () => {
  it("registers a resolve subcommand", () => {
    const program = new Command();
    registerResolveCommand(program, async () => {});
    expect(program.commands.find((c) => c.name() === "resolve")).toBeDefined();
  });

  it("passes the --vault flag through to the runner", async () => {
    const program = new Command().exitOverride();
    const seen: Array<{ vaultFlag?: string; basePath?: string; out: (line: string) => void }> = [];
    registerResolveCommand(
      program,
      async (input: { vaultFlag?: string; basePath?: string; out: (line: string) => void }) => {
        seen.push(input);
      },
    );
    await program.parseAsync(["resolve", "--vault", "/path/to/vault"], { from: "user" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.vaultFlag).toBe("/path/to/vault");
  });

  // add-project-config 3.3 (AD-6): the commander action is the true
  // ambient edge — the launch directory is injected here, nowhere else.
  it("hands the runner the ambient cwd as basePath", async () => {
    const program = new Command().exitOverride();
    const seen: Array<{ vaultFlag?: string; basePath?: string; out: (line: string) => void }> = [];
    registerResolveCommand(
      program,
      async (input: { vaultFlag?: string; basePath?: string; out: (line: string) => void }) => {
        seen.push(input);
      },
    );
    await program.parseAsync(["resolve"], { from: "user" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.basePath).toBe(process.cwd());
  });
});

describe("runResolveCommand (real engine conflict + scripted prompt)", () => {
  it("resolves the conflict: merged note committed and pushed, conflict note flipped", async () => {
    const { vault, remote } = await conflictedVault();
    try {
      const bareTipBefore = (
        await simpleGit(remote.remoteUrl).raw(["rev-parse", "HEAD"])
      ).trim();
      const lines: string[] = [];
      const merged = specNote("SPEC-9", "Merged Nine");
      await runResolveCommand({
        vaultFlag: vault.root,
        basePath: vault.root,
        out: (line: string) => lines.push(line),
        prompt: scriptedPrompt(() => merged),
      });

      const text = lines.join("\n");
      expect(text).toMatch(/SPEC-9/);
      expect(text).toMatch(/resolved/);

      // The finalize commit + push landed on the remote.
      const bareTipAfter = (
        await simpleGit(remote.remoteUrl).raw(["rev-parse", "HEAD"])
      ).trim();
      expect(bareTipAfter).not.toBe(bareTipBefore);
      const subject = (
        await simpleGit(vault.root).raw(["log", "--format=%s", "-1"])
      ).trim();
      expect(subject).toMatch(/^note\(update\): spec "Merged Nine" \[SPEC-9\]/);
      expect(subject).toMatch(/conflict resolved/);

      // The conflict note is flipped on disk.
      const raw = await readFile(await conflictNotePath(vault), "utf8");
      expect(raw).toContain("status: resolved");
    } finally {
      await remote.cleanup();
    }
  });

  it("reports ownership (LOCK_HELD) and touches nothing when another actor holds the lock", async () => {
    const { vault } = await conflictedVault();
    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"]);
    try {
      const serverLock = new PidfileLock({ vaultRoot: vault.root, pid: holder.pid });
      const handle = await serverLock.acquire("server");
      expect(handle).not.toBeNull();

      const lines: string[] = [];
      await expect(
        runResolveCommand({
          vaultFlag: vault.root,
          basePath: vault.root,
          out: (line: string) => lines.push(line),
          prompt: scriptedPrompt(() => null),
        }),
      ).rejects.toMatchObject({ code: "LOCK_HELD" });
      expect(lines.join("\n")).toMatch(String(holder.pid));
      await handle?.release();
    } finally {
      holder.kill();
      await vault.cleanup();
    }
  });

  it("a declined merge skips the conflict and exits cleanly, note still open", async () => {
    const { vault } = await conflictedVault();
    try {
      const lines: string[] = [];
      await runResolveCommand({
        vaultFlag: vault.root,
        basePath: vault.root,
        out: (line: string) => lines.push(line),
        prompt: scriptedPrompt(() => null),
      });
      const text = lines.join("\n");
      expect(text).toMatch(/skipped/);
      expect(text).not.toMatch(/resolved/);
      const raw = await readFile(await conflictNotePath(vault), "utf8");
      expect(raw).toContain("status: open");
    } finally {
      await vault.cleanup();
    }
  });

  it("with no open conflicts it reports so and exits cleanly", async () => {
    const vault = await createTestVault();
    try {
      const lines: string[] = [];
      await expect(
        runResolveCommand({
          vaultFlag: vault.root,
          basePath: vault.root,
          out: (line: string) => lines.push(line),
          prompt: scriptedPrompt(() => null),
        }),
      ).resolves.toBeUndefined();
      expect(lines.join("\n")).toMatch(/no open conflicts/i);
    } finally {
      await vault.cleanup();
    }
  });

  it("surfaces a per-conflict failure as an AppError (exit contract)", async () => {
    const { vault } = await conflictedVault();
    try {
      const lines: string[] = [];
      // A secret in the merged content: finalize is blocked before
      // anything is committed (design §4.6).
      const withSecret = specNote("SPEC-9", "Merged Nine").replace(
        "Body text.",
        "key = AKIAIOSFODNN7EXAMPLE",
      );
      await expect(
        runResolveCommand({
          vaultFlag: vault.root,
          basePath: vault.root,
          out: (line: string) => lines.push(line),
          prompt: scriptedPrompt(() => withSecret),
        }),
      ).rejects.toMatchObject({ code: "SECRETS_BLOCKED" });
      expect(lines.join("\n")).toMatch(/failed/);
    } finally {
      await vault.cleanup();
    }
  });

  it("an AppError thrown by the boot path propagates untouched", async () => {
    await expect(
      runResolveCommand({
        vaultFlag: "/nonexistent/vault/for/resolve/test",
        // Flag short-circuits resolution; basePath is required by the
        // input contract (AD-6) and read here as a value only.
        basePath: process.cwd(),
        out: () => {},
        prompt: scriptedPrompt(() => null),
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  // Phase 6 gate — first-class acceptance case (a), the resolve half:
  // the project file at the WORK-TREE ROOT names the vault; resolve
  // launched from a nested subdirectory (no --vault flag) must find it
  // through AD-1 discovery and run the guided flow against that vault.
  // If basePath stopped flowing into the chain, resolution would fall
  // back to the ambient cwd (this repo's root — not a project) and boot
  // would fail with NO_VAULT_CONFIGURED. Hermetic per suite discipline:
  // the ambient env carries no SUPERMEMORY_VAULT (the p1 gate pins
  // that), and no test mutates process.env.
  it("resolves the root project file's vault from a subdirectory launch", async () => {
    const { vault, remote } = await conflictedVault();
    const project = await makeProjectDir({
      config: { vault: vault.root },
      nested: "packages/app",
    });
    try {
      const lines: string[] = [];
      const merged = specNote("SPEC-9", "Merged Nine");
      await runResolveCommand({
        basePath: project.subdir as string,
        out: (line: string) => lines.push(line),
        prompt: scriptedPrompt(() => merged),
      });

      expect(lines.join("\n")).toMatch(/resolved/);
      // The guided flow landed in the vault the ROOT config names.
      const raw = await readFile(await conflictNotePath(vault), "utf8");
      expect(raw).toContain("status: resolved");
    } finally {
      await project.cleanup();
      await remote.cleanup();
    }
  });
});
