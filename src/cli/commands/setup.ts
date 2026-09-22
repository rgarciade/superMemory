import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { input, confirm } from "@inquirer/prompts";
import { simpleGit } from "simple-git";
import { AppError } from "../../util/errors.js";
import { createLogger } from "../../util/log.js";
import { validateBoot } from "../../boot/validate-boot.js";
import {
  loadGlobalConfig,
  saveGlobalConfig,
} from "../../config/global-config.js";
import { ProcessEnvSource, type EnvSource } from "../../config/env.js";

/**
 * `supermemory setup` — the one-time per-member wizard (RFC §7.2): a
 * validated vault path, the author identity (defaulted from the vault's
 * git config), written to the global config as `vaults.default`. This
 * command is the remediation target of `No vault configured. Run:
 * supermemory setup`.
 *
 * The interactive surface lives behind the PromptPort seam; @inquirer/
 * prompts stays at the edge so tests script the flow without a TTY.
 */

export interface PromptPort {
  vaultPath(message: string): Promise<string>;
  authorName(message: string, defaultValue?: string): Promise<string>;
  authorEmail(message: string, defaultValue?: string): Promise<string>;
  confirm(message: string): Promise<boolean>;
}

export const consolePrompts: PromptPort = {
  vaultPath: (message) => input({ message }),
  authorName: (message, defaultValue) =>
    defaultValue === undefined
      ? input({ message })
      : input({ message, default: defaultValue }),
  authorEmail: (message, defaultValue) =>
    defaultValue === undefined
      ? input({ message })
      : input({ message, default: defaultValue }),
  confirm: (message) => confirm({ message }),
};

export interface SetupResult {
  vault: string;
  author: { name: string; email: string };
}

const MAX_VAULT_ATTEMPTS = 5;

export async function runSetup(
  prompts: PromptPort,
  env: EnvSource,
): Promise<SetupResult> {
  // (1) vault path — re-prompt until boot validation passes
  let vault: string | undefined;
  let lastError: AppError | undefined;
  for (let attempt = 0; attempt < MAX_VAULT_ATTEMPTS; attempt += 1) {
    const answer = (await prompts.vaultPath(
      "Vault path (a git repository with .memory/rules.md):",
    )).trim();
    if (answer === "") continue;
    const resolved = resolveVaultPath(answer);
    try {
      await validateBoot(resolved);
      vault = resolved;
      break;
    } catch (err) {
      lastError =
        err instanceof AppError
          ? err
          : new AppError("BOOT_VALIDATION_FAILED", String(err));
      const tryAnother = await prompts.confirm(
        `${lastError.message}\nTry another path?`,
      );
      if (!tryAnother) break;
    }
  }
  if (vault === undefined) {
    throw lastError ??
      new AppError("BOOT_VALIDATION_FAILED", "no vault path provided.", {
        hint: "Run `supermemory init` inside a fresh git repo first, then re-run setup.",
      });
  }

  // (2) author identity — defaults from the vault's git config
  const gitIdentity = await readGitIdentity(vault);
  const name = (await prompts.authorName(
    "Your author name (git blame shows this):",
    gitIdentity.name,
  )).trim();
  const email = (await prompts.authorEmail(
    "Your author email:",
    gitIdentity.email,
  )).trim();

  // (3) confirm + write the global config
  const ok = await prompts.confirm(
    `Write vaults.default=${vault} and author "${name} <${email}>" to the global config?`,
  );
  if (!ok) {
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      "setup cancelled — nothing was written.",
    );
  }
  const existing = await loadGlobalConfig(env);
  await saveGlobalConfig(env, {
    ...existing,
    vaults: { ...existing.vaults, default: vault },
    author: { name, email },
  });

  return { vault, author: { name, email } };
}

/**
 * Expands a leading `~` to the home directory and resolves the result to
 * an absolute path. A vault path saved as typed (relative, or with `~`
 * left unexpanded) breaks once supermemory is later launched from a
 * different cwd, or rejects `~` outright since it is shell syntax, not
 * filesystem syntax.
 */
function resolveVaultPath(raw: string): string {
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return path.resolve(os.homedir(), raw.slice(2));
  }
  return path.resolve(raw);
}

async function readGitIdentity(
  vault: string,
): Promise<{ name?: string; email?: string }> {
  try {
    const git = simpleGit(vault);
    const name = (await git.raw(["config", "user.name"])).trim();
    const email = (await git.raw(["config", "user.email"])).trim();
    return { name: name || undefined, email: email || undefined };
  } catch {
    return {};
  }
}

export function registerSetupCommand(program: Command): void {
  const log = createLogger();
  program
    .command("setup")
    .description(
      "One-time wizard: point supermemory at your vault and identity.",
    )
    .action(async () => {
      const result = await runSetup(consolePrompts, new ProcessEnvSource());
      log.info(
        `setup complete — default vault: ${result.vault} (author: ${result.author.name})`,
      );
    });
}
