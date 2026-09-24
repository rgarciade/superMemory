import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { simpleGit } from "simple-git";
import { AppError } from "../../../src/util/errors.js";
import { PidfileLock } from "../../../src/sync/lock.js";
import {
  formatCycleReport,
  registerSyncCommand,
  runSyncCommand,
} from "../../../src/cli/commands/sync.js";
import type { CycleReport } from "../../../src/sync/engine.js";
import { createTestVault, type TestVault } from "../../helpers/create-test-vault.js";
import { connectVaultToRemote, type RemoteVault } from "../../helpers/remote-vault.js";

// Task 3.11 [RED first]: `supermemory sync` — a single runCycle('manual'),
// an outcome report, and NO scheduler start (design §4.2: "the CLI `sync`
// runs a single runCycle('manual') without starting a scheduler"). The
// command boots the real engine over the resolved vault (flag → env →
// config, same resolution as serve), runs one manual cycle, prints the
// outcome report, and maps failure outcomes to the AppError → exit-code
// contract (runMain).

function specNote(id: string, title: string): string {
  return `---\nspec_id: ${id}\nstatus: draft\nowner: team\n---\n\n# ${title}\n\nBody text.\n`;
}

interface Out { lines: string[] }
function captureOut(): { io: Out; lines: string[] } {
  const lines: string[] = [];
  return { io: { lines }, lines };
}
// The runner's `out` seam takes a printer; tests collect the lines.
function outOf(io: Out): (line: string) => void {
  return (line) => io.lines.push(line);
}

async function vaultWithRemoteAndPendingWrite(): Promise<{
  vault: TestVault;
  remote: RemoteVault;
  bareTipBefore: string;
}> {
  const vault = await createTestVault({
    seedNotes: [{ path: "specs/SPEC-1.md", content: specNote("SPEC-1", "Base") }],
  });
  const remote = await connectVaultToRemote(vault);
  // A pending HUMAN write: on disk, uncommitted — the engine's step-3
  // human-change path must pick it up, commit it with the grammar, push.
  await vault.write("specs/SPEC-2.md", specNote("SPEC-2", "Pending"));
  const bareTipBefore = await simpleGit(remote.remoteUrl).raw(["rev-parse", "HEAD"]);
  return { vault, remote, bareTipBefore: bareTipBefore.trim() };
}

describe("registerSyncCommand", () => {
  it("registers a sync subcommand", () => {
    const program = new Command();
    registerSyncCommand(program, async () => {});
    expect(program.commands.find((c) => c.name() === "sync")).toBeDefined();
  });

  it("passes the --vault flag through to the runner", async () => {
    const program = new Command().exitOverride();
    const seen: Array<{ vaultFlag?: string; out: (line: string) => void }> = [];
    registerSyncCommand(program, async (opts: { vaultFlag?: string; out: (line: string) => void }) => {
      seen.push(opts);
    });
    await program.parseAsync(["sync", "--vault", "/path/to/vault"], { from: "user" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.vaultFlag).toBe("/path/to/vault");
  });

  it("hands the runner a stdout printer and no vault flag by default", async () => {
    const program = new Command().exitOverride();
    const seen: Array<{ vaultFlag?: string; out: (line: string) => void }> = [];
    registerSyncCommand(program, async (opts: { vaultFlag?: string; out: (line: string) => void }) => {
      seen.push(opts);
    });
    await program.parseAsync(["sync"], { from: "user" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.vaultFlag).toBeUndefined();
    expect(typeof seen[0]?.out).toBe("function");
  });
});

describe("formatCycleReport", () => {
  it("renders the outcome, push state, and commit count", () => {
    const report: CycleReport = {
      trigger: "manual",
      outcome: "synced",
      pushed: true,
      commits: ["a".repeat(40), "b".repeat(40)],
      blocked: [],
      conflicts: [],
    };
    const lines = formatCycleReport(report);
    expect(lines.join("\n")).toMatch(/sync outcome: synced/);
    expect(lines.join("\n")).toMatch(/trigger: manual/);
    expect(lines.join("\n")).toMatch(/pushed: yes/);
    expect(lines.join("\n")).toMatch(/commits: 2/);
  });

  it("names each blocked write, open conflict, and the lock holder", () => {
    const report: CycleReport = {
      trigger: "manual",
      outcome: "secrets-blocked",
      pushed: true,
      commits: [],
      blocked: [
        { path: "specs/SPEC-9.md", code: "SECRETS_BLOCKED", message: "AWS key at line 3" },
      ],
      conflicts: [
        {
          noteId: "SPEC-9",
          notePath: "specs/SPEC-9.md",
          snapshotBranch: "conflict/20250601-1200-SPEC-9",
          conflictNotePath: "/vault/conflicts/20250601-1200-SPEC-9.md",
          detectedAt: "2025-06-01T12:00:00.000Z",
        },
      ],
    };
    const text = formatCycleReport(report).join("\n");
    expect(text).toMatch(/SECRETS_BLOCKED specs\/SPEC-9\.md/);
    expect(text).toMatch(/conflicts: 1/);
    expect(text).toMatch(/conflict\/20250601-1200-SPEC-9/);
  });

  it("renders the ownership report when the lock is held", () => {
    const report: CycleReport = {
      trigger: "manual",
      outcome: "locked",
      pushed: false,
      commits: [],
      blocked: [],
      conflicts: [],
      lockHolder: { pid: 4242, owner: "server" },
    };
    const text = formatCycleReport(report).join("\n");
    expect(text).toMatch(/sync outcome: locked/);
    expect(text).toMatch(/pid 4242/);
    expect(text).toMatch(/server/);
  });
});

describe("runSyncCommand (real boot over a hermetic vault + bare remote)", () => {
  it("runs one manual cycle: commits the pending write, pushes, reports synced", async () => {
    const { vault, remote, bareTipBefore } = await vaultWithRemoteAndPendingWrite();
    try {
      const { io, lines } = captureOut();
      await runSyncCommand({ vaultFlag: vault.root, out: outOf(io) });

      const text = lines.join("\n");
      expect(text).toMatch(/sync outcome: synced/);
      expect(text).toMatch(/trigger: manual/);
      expect(text).toMatch(/pushed: yes/);

      // The pending write was committed with the grammar and pushed: the
      // bare remote tip moved, and the vault sits exactly on it.
      const bareTipAfter = (
        await simpleGit(remote.remoteUrl).raw(["rev-parse", "HEAD"])
      ).trim();
      expect(bareTipAfter).not.toBe(bareTipBefore);
      const head = (await simpleGit(vault.root).raw(["rev-parse", "HEAD"])).trim();
      expect(head).toBe(bareTipAfter);

      const subjects = (await simpleGit(vault.root).raw(["log", "--format=%s", "-2"]))
        .split("\n")
        .filter((line) => line !== "");
      // The note commit uses the grammar; the real index port also lands
      // its own separate chore(index) regeneration commit (design §4.1).
      expect(subjects).toContain("note(add): spec \"Pending\" [SPEC-2]");
      expect(subjects.some((s) => /^chore\(index\): regenerate maps/.test(s))).toBe(true);
      expect(subjects).toHaveLength(2);
    } finally {
      await remote.cleanup();
    }
  });

  it("reports ownership (LOCK_HELD) and mutates nothing when the server owns the lock", async () => {
    const { vault, remote, bareTipBefore } = await vaultWithRemoteAndPendingWrite();
    // A genuinely LIVE other pid: a sleeping child process.
    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"]);
    try {
      const serverLock = new PidfileLock({ vaultRoot: vault.root, pid: holder.pid });
      const handle = await serverLock.acquire("server");
      expect(handle).not.toBeNull();

      const { io, lines } = captureOut();
      await expect(runSyncCommand({ vaultFlag: vault.root, out: outOf(io) })).rejects.toBeInstanceOf(
        AppError,
      );
      await expect(
        runSyncCommand({ vaultFlag: vault.root, out: outOf(io) }).catch((err: unknown) => {
          throw err;
        }),
      ).rejects.toMatchObject({ code: "LOCK_HELD" });
      expect(lines.join("\n")).toMatch(/sync outcome: locked/);
      expect(lines.join("\n")).toMatch(String(holder.pid));

      // Nothing was committed or pushed while the lock was held.
      const bareTipAfter = (
        await simpleGit(remote.remoteUrl).raw(["rev-parse", "HEAD"])
      ).trim();
      expect(bareTipAfter).toBe(bareTipBefore);
      await handle?.release();
    } finally {
      holder.kill();
      await remote.cleanup();
    }
  });
});
