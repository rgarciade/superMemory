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
import { makeProjectDir } from "../../helpers/project.js";

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
    const seen: Array<{ vaultFlag?: string; basePath?: string; out: (line: string) => void }> = [];
    registerSyncCommand(
      program,
      async (opts: { vaultFlag?: string; basePath?: string; out: (line: string) => void }) => {
        seen.push(opts);
      },
    );
    await program.parseAsync(["sync", "--vault", "/path/to/vault"], { from: "user" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.vaultFlag).toBe("/path/to/vault");
  });

  it("hands the runner a stdout printer, no vault flag, and the ambient cwd as basePath", async () => {
    const program = new Command().exitOverride();
    const seen: Array<{ vaultFlag?: string; basePath?: string; out: (line: string) => void }> = [];
    registerSyncCommand(
      program,
      async (opts: { vaultFlag?: string; basePath?: string; out: (line: string) => void }) => {
        seen.push(opts);
      },
    );
    await program.parseAsync(["sync"], { from: "user" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.vaultFlag).toBeUndefined();
    expect(typeof seen[0]?.out).toBe("function");
    // The commander action is the true ambient edge (add-project-config
    // AD-6): the launch directory is injected here, nowhere else.
    expect(seen[0]?.basePath).toBe(process.cwd());
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
      await runSyncCommand({ vaultFlag: vault.root, basePath: vault.root, out: outOf(io) });

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
      await expect(
        runSyncCommand({ vaultFlag: vault.root, basePath: vault.root, out: outOf(io) }),
      ).rejects.toBeInstanceOf(AppError);
      await expect(
        runSyncCommand({ vaultFlag: vault.root, basePath: vault.root, out: outOf(io) }).catch(
          (err: unknown) => {
            throw err;
          },
        ),
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

  // add-project-config 3.3 (AD-7, sync-ladder delta "Commit uses the
  // project config author"): the commit identity comes from the project
  // config at the launch root — the --vault flag is passed explicitly so
  // this run is hermetic regardless of any ambient SUPERMEMORY_VAULT;
  // the resolution chain itself is pinned by project-config's own suite
  // and the server boot tests.
  it("commits with the project config's author when the project file declares one", async () => {
    const { vault, remote } = await vaultWithRemoteAndPendingWrite();
    const project = await makeProjectDir({
      config: {
        vault: vault.root,
        author: { name: "Project Author", email: "project@example.com" },
      },
    });
    try {
      const { io } = captureOut();
      await runSyncCommand({
        vaultFlag: vault.root,
        basePath: project.root,
        out: outOf(io),
      });

      // The engine lands exactly two commits (note + chore(index), the
      // pinned shape above); BOTH carry the project author via --author.
      const authors = (await simpleGit(vault.root).raw(["log", "--format=%an <%ae>", "-2"]))
        .split("\n")
        .filter((line) => line !== "");
      expect(authors).toHaveLength(2);
      for (const author of authors) {
        expect(author).toBe("Project Author <project@example.com>");
      }
    } finally {
      await project.cleanup();
      await remote.cleanup();
    }
  });

  // The degradation half (sync-ladder delta "Project config without
  // author degrades to inherited Git identity"): no author in the file
  // ⇒ author is undefined ⇒ the git client commits without --author and
  // the vault repo's own local git config speaks. Same hermetic shape as
  // the with-author case: the flag pins resolution; basePath drives the
  // author lookup.
  it("degrades to the vault's inherited Git identity when the project file has no author", async () => {
    const { vault, remote } = await vaultWithRemoteAndPendingWrite();
    const project = await makeProjectDir({ config: { vault: vault.root } });
    try {
      const { io } = captureOut();
      await runSyncCommand({
        vaultFlag: vault.root,
        basePath: project.root,
        out: outOf(io),
      });

      const git = simpleGit(vault.root);
      const inherited =
        `${(await git.raw(["config", "user.name"])).trim()} ` +
        `<${(await git.raw(["config", "user.email"])).trim()}>`;
      const authors = (await git.raw(["log", "--format=%an <%ae>", "-2"]))
        .split("\n")
        .filter((line) => line !== "");
      expect(authors).toHaveLength(2);
      for (const author of authors) {
        expect(author).toBe(inherited);
      }
    } finally {
      await project.cleanup();
      await remote.cleanup();
    }
  });
});
