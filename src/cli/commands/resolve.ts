import type { Command } from "commander";
import { confirm, editor } from "@inquirer/prompts";
import { validateBoot } from "../../boot/validate-boot.js";
import { ProcessEnvSource } from "../../config/env.js";
import {
  loadProjectConfig,
  projectAuthor,
  resolveVaultPath,
} from "../../config/project-config.js";
import { loadRules } from "../../rules/parser.js";
import { createGitClient } from "../../sync/git.js";
import { PidfileLock } from "../../sync/lock.js";
import {
  runResolve,
  type MergePromptContext,
  type ResolveOutcome,
  type ResolvePromptPort,
} from "../../sync/resolve.js";
import { AppError } from "../../util/errors.js";
import { vaultPaths } from "../../util/paths.js";

/**
 * `supermemory resolve` (task 3.12) — the CLI entry for the guided
 * conflict-resolution flow (3.10, design §4.4 step 5). Exactly the
 * setup.ts pattern inverted: the flow itself stays prompt-agnostic
 * behind the injectable `ResolvePromptPort`; this command binds the
 * REAL terminal prompts (@inquirer/prompts) at the edge.
 *
 * Locking is per invocation (design §4.5): the server's engine holds
 * the pidfile lock across its cycles; the CLI acquires for the duration
 * of the guided flow and, when held, reports ownership instead of
 * racing (M1: report, don't delegate — OD-4).
 *
 * Exit contract (design §1.5): a held lock or any failed per-conflict
 * outcome throws the mapped `AppError` AFTER the outcomes are printed.
 */

export interface ResolveCommandInput {
  vaultFlag?: string;
  /**
   * Launch directory for project-config discovery (add-project-config
   * AD-1). REQUIRED: the commander action (the true ambient edge)
   * injects `process.cwd()`; tests inject the fixture root.
   */
  basePath: string;
  out: (line: string) => void;
  /** Injectable for tests; defaults to the real terminal prompts. */
  prompt?: ResolvePromptPort;
}

export type ResolveRunner = (input: ResolveCommandInput) => Promise<void>;

/**
 * The real terminal binding. `mergeSides` presents both sides' paths,
 * then opens the human's editor prefilled with the LOCAL side (the
 * remote side sits next to it on disk for reference); cancelling the
 * editor declines the merge. `confirmFinalize` gates commit + push.
 */
export const consoleResolvePrompt: ResolvePromptPort = {
  async mergeSides(context: MergePromptContext): Promise<string | null> {
    process.stdout.write(
      [
        `conflict: ${context.noteId} (${context.notePath})`,
        `  local  (working tree): ${context.localPath}`,
        `  remote (snapshot):     ${context.remotePath}`,
        `The editor opens with the local side — merge in the remote changes.`,
      ].join("\n") + "\n",
    );
    try {
      return await editor({
        message: `Merged content for ${context.notePath}:`,
        default: context.localContent,
      });
    } catch {
      return null; // editor cancelled — decline this conflict
    }
  },

  confirmFinalize(context: MergePromptContext): Promise<boolean> {
    return confirm({ message: `Commit and push the merged ${context.notePath}?` });
  },
};

export function registerResolveCommand(
  program: Command,
  run: ResolveRunner = runResolveCommand,
): void {
  program
    .command("resolve")
    .description("Guided conflict resolution: merge both sides of an open conflict.")
    .option(
      "--vault <path>",
      "vault path (overrides SUPERMEMORY_VAULT / the project's supermemory.json)",
    )
    .action(async (opts: { vault?: string }) => {
      // The launch directory is injected HERE — the one ambient edge (AD-6).
      await run({
        vaultFlag: opts.vault,
        basePath: process.cwd(),
        out: (line) => process.stdout.write(`${line}\n`),
      });
    });
}

/** One human-readable line per conflict outcome. */
export function formatResolveOutcome(outcome: ResolveOutcome): string {
  switch (outcome.result) {
    case "resolved":
      return `resolved: ${outcome.noteId} (${outcome.notePath}) — commit ${
        outcome.commitSha?.slice(0, 12) ?? "?"
      }`;
    case "skipped":
      return `skipped: ${outcome.noteId} (${outcome.notePath}) — ${outcome.reason ?? "declined"}`;
    case "failed":
      return `failed: ${outcome.noteId} (${outcome.notePath}) — ${
        outcome.code ?? "error"
      }: ${outcome.reason ?? ""}`;
  }
}

/** Boots the guided flow over the resolved vault, holding the sync lock throughout. */
export async function runResolveCommand(input: ResolveCommandInput): Promise<void> {
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

  const lock = new PidfileLock({ vaultRoot: vaultPath });
  const handle = await lock.acquire("cli");
  if (handle === null) {
    const holder = await lock.currentHolder().catch(() => null);
    input.out("resolve outcome: locked");
    if (holder !== null) {
      input.out(`lock holder: pid ${holder.pid} (${holder.owner})`);
    }
    throw new AppError(
      "LOCK_HELD",
      holder !== null
        ? `sync is owned by another actor (pid ${holder.pid}, ${holder.owner})`
        : "sync is owned by another actor",
      {
        hint: "Wait for the owning process to finish its sync cycle, then resolve.",
      },
    );
  }

  try {
    const rules = await loadRules(vaultPaths(vaultPath).rulesPath);
    // AD-7: the commit identity comes from the project config at the
    // launch root — absent ⇒ undefined ⇒ the finalize commit inherits
    // the vault's own Git identity.
    const report = await runResolve({
      vaultPath,
      rules,
      git: createGitClient(vaultPath),
      prompt: input.prompt ?? consoleResolvePrompt,
      author: projectAuthor(await loadProjectConfig(input.basePath)),
      via: "cli",
    });

    if (report.outcomes.length === 0) {
      input.out("no open conflicts — nothing to resolve");
      return;
    }
    for (const outcome of report.outcomes) input.out(formatResolveOutcome(outcome));

    const failed = report.outcomes.find((outcome) => outcome.result === "failed");
    if (failed !== undefined) {
      throw new AppError(
        failed.code ?? "CONFLICT_CURATED",
        `resolve failed for ${failed.noteId}: ${failed.reason ?? "unknown error"}`,
        {
          hint: "Local state is intact. Resolve manually with plain git, or delete the conflict note once settled.",
        },
      );
    }
  } finally {
    await handle.release();
  }
}
