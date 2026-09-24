import type { Command } from "commander";
import { validateBoot } from "../../boot/validate-boot.js";
import { ProcessEnvSource } from "../../config/env.js";
import {
  loadProjectConfig,
  projectAuthor,
  projectSyncOverrides,
  resolveVaultPath,
} from "../../config/project-config.js";
import { buildIndex } from "../../index/build.js";
import { createVaultSyncStack } from "../../mcp/server.js";
import { loadRules } from "../../rules/parser.js";
import type { CycleReport } from "../../sync/engine.js";
import { SystemClock } from "../../util/clock.js";
import { AppError } from "../../util/errors.js";
import { vaultPaths } from "../../util/paths.js";

/**
 * `supermemory sync` (design §4.2) — the manual trigger: ONE
 * `runCycle('manual')` over the fully-wired real engine (pidfile lock,
 * git client, index port — the same production assembly `serve` uses,
 * `createVaultSyncStack`), an outcome report on stdout, and NO
 * scheduler start (the CLI process must never sit on a pending timer;
 * production timers are `.unref()`ed anyway, but the scheduler is not
 * even created-armed here).
 *
 * Exit contract (design §1.5): every non-success cycle outcome throws
 * the mapped `AppError` AFTER the report is printed, so `runMain`
 * prints code + message + hint and exits 1. `synced`/`idle` exit 0.
 */

export interface SyncCommandInput {
  vaultFlag?: string;
  /**
   * Launch directory for project-config discovery (add-project-config
   * AD-1). REQUIRED: the commander action (the true ambient edge)
   * injects `process.cwd()`; tests inject the fixture root.
   */
  basePath: string;
  out: (line: string) => void;
}

export type SyncRunner = (input: SyncCommandInput) => Promise<void>;

export function registerSyncCommand(
  program: Command,
  run: SyncRunner = runSyncCommand,
): void {
  program
    .command("sync")
    .description("Run one full sync cycle now: commit pending writes, pull, push.")
    .option(
      "--vault <path>",
      "vault path (overrides SUPERMEMORY_VAULT / the project's supermemory.json)",
    )
    .action(async (opts: { vault?: string }) => {
      // The outcome report is the command's product: stdout (only `serve`
      // reserves stdout for the MCP protocol — design §1.6). The launch
      // directory is injected HERE — the one ambient edge (AD-6).
      await run({
        vaultFlag: opts.vault,
        basePath: process.cwd(),
        out: (line) => process.stdout.write(`${line}\n`),
      });
    });
}

/** The human-readable outcome report — one line per fact, no logging framework. */
export function formatCycleReport(report: CycleReport): string[] {
  const lines: string[] = [];
  lines.push(`sync outcome: ${report.outcome} (trigger: ${report.trigger})`);
  lines.push(`pushed: ${report.pushed ? "yes" : "no"}`);
  lines.push(`commits: ${report.commits.length}`);
  if (report.blocked.length > 0) {
    lines.push(`blocked: ${report.blocked.length}`);
    for (const blocked of report.blocked) {
      lines.push(`  ${blocked.code} ${blocked.path}: ${blocked.message}`);
    }
  }
  if (report.conflicts.length > 0) {
    lines.push(`conflicts: ${report.conflicts.length}`);
    for (const conflict of report.conflicts) {
      lines.push(`  ${conflict.noteId} (${conflict.notePath}) — snapshot: ${conflict.snapshotBranch}`);
    }
  }
  if (report.lockHolder !== undefined) {
    lines.push(`lock holder: pid ${report.lockHolder.pid} (${report.lockHolder.owner})`);
  }
  if (report.error !== undefined) {
    lines.push(`error: ${report.error.code} ${report.error.message}`);
  }
  return lines;
}

/**
 * Maps a non-success cycle outcome to the AppError the bin entry turns
 * into exit code 1 (the report itself has already been printed — these
 * are failure signals, not the report).
 */
function failureOf(report: CycleReport): AppError | undefined {
  switch (report.outcome) {
    case "synced":
    case "idle":
      return undefined;
    case "locked":
      return new AppError(
        "LOCK_HELD",
        report.lockHolder !== undefined
          ? `sync is owned by another actor (pid ${report.lockHolder.pid}, ${report.lockHolder.owner})`
          : "sync is owned by another actor",
        {
          hint: "Use the sync tool on the owning server, or wait for its current cycle to finish.",
        },
      );
    case "conflict":
      return new AppError(
        report.error?.code ?? "CONFLICT_CURATED",
        report.error?.message ??
          "the cycle hit a curated conflict — the rebase was aborted and local state is intact",
        { hint: "Run `supermemory resolve` to merge both sides, then sync again." },
      );
    case "secrets-blocked":
      return new AppError(
        "SECRETS_BLOCKED",
        report.error?.message ??
          `${report.blocked.length} write(s) blocked — a flagged secret was found`,
        { hint: "Remove the secret from the named files, then run supermemory sync again." },
      );
    case "push-failed":
      return new AppError(
        report.error?.code ?? "SYNC_FAILED",
        report.error?.message ?? "the push failed after retries — local commits are intact",
        {
          hint: "Check the remote connection; local writes are safe and will push on a later cycle.",
        },
      );
    case "rules-refused":
      return new AppError(
        report.error?.code ?? "FORMAT_VERSION_UNSUPPORTED",
        report.error?.message ?? "the vault's rules were refused",
        {
          hint: "Update supermemory to the version the vault requires, then sync again.",
        },
      );
  }
}

/** Boots the real engine over the resolved vault and runs ONE manual cycle. */
export async function runSyncCommand(input: SyncCommandInput): Promise<void> {
  const env = new ProcessEnvSource();
  // The spec-frozen chain (flag → SUPERMEMORY_VAULT → project file at the
  // nearest work-tree root of basePath); unresolvable ⇒ the pinned
  // NO_VAULT_CONFIGURED error from config/project-config.
  const vaultPath = await resolveVaultPath({
    vaultFlag: input.vaultFlag,
    env,
    basePath: input.basePath,
  });
  await validateBoot(vaultPath);

  const rules = await loadRules(vaultPaths(vaultPath).rulesPath);
  // AD-7: the commit identity comes from the project config at the launch
  // root — absent ⇒ undefined ⇒ commits inherit the vault's own Git
  // identity (the degradation path is the same injected optional dep as
  // before; only the source swapped).
  const projectConfig = await loadProjectConfig(input.basePath);
  const author = projectAuthor(projectConfig);

  const { engine } = await createVaultSyncStack({
    vaultPath,
    rules,
    store: await buildIndex(vaultPath, rules),
    clock: new SystemClock(),
    env,
    author,
    projectSync: projectSyncOverrides(projectConfig),
    owner: "cli",
  });

  const report = await engine.runCycle("manual");
  for (const line of formatCycleReport(report)) input.out(line);

  const failure = failureOf(report);
  if (failure !== undefined) throw failure;
}
