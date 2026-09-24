import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { input, confirm } from "@inquirer/prompts";
import { directoryInput } from "./setup-completion.js";
import { simpleGit } from "simple-git";
import { AppError } from "../../util/errors.js";
import { createLogger } from "../../util/log.js";
import { appendMissingLines } from "../../util/append-lines.js";
import { validateBoot } from "../../boot/validate-boot.js";
import {
  EXAMPLE_CONFIG_CONTENT,
  EXAMPLE_CONFIG_FILENAME,
  findProjectRoot,
  PROJECT_CONFIG_FILENAME,
  DEBOUNCE_SECONDS_BOUNDS,
  SYNC_INTERVAL_MINUTES_BOUNDS,
  isValidDebounceSeconds,
  isValidSyncIntervalMinutes,
} from "../../config/project-config.js";
import {
  DEFAULT_DEBOUNCE_SECONDS,
  DEFAULT_SYNC_INTERVAL_MINUTES,
} from "../../config/vault-config.js";

/**
 * `supermemory setup` — the per-project wizard (specs/project-config):
 * a validated vault path and the author identity (defaulted from the
 * vault's git config), written as the project's gitignored
 * `supermemory.json` at the work-tree root, together with one appended
 * `.gitignore` line and the committed `supermemory.example.json`
 * onboarding template (created only when absent). This command is the
 * remediation target of `No vault configured. Run: supermemory setup`.
 *
 * Guards refuse meaningless locations BEFORE any prompt or write
 * (design AD-2): the home root — even when it happens to be a git
 * repository — and any location outside a Git work tree, both as
 * `SETUP_LOCATION_REFUSED`. The launch directory and the home are
 * INJECTED (`io`), so tests are hermetic: no chdir, no env mutation,
 * no HOME writes.
 *
 * The interactive surface lives behind the PromptPort seam; @inquirer/
 * prompts stays at the edge so tests script the flow without a TTY.
 * The wizard itself never logs: the commander action owns the
 * completion log and the one-time legacy-config hint line (AD-4).
 */

export interface PromptPort {
  vaultPath(message: string): Promise<string>;
  authorName(message: string, defaultValue?: string): Promise<string>;
  authorEmail(message: string, defaultValue?: string): Promise<string>;
  confirm(message: string): Promise<boolean>;
  /** Raw answer for the debounce window (seconds); validated by the wizard. */
  debounceSeconds(message: string, defaultValue: number): Promise<string>;
  /** Raw answer for the pull interval (minutes); validated by the wizard. */
  syncIntervalMinutes(message: string, defaultValue: number): Promise<string>;
}

export const consolePrompts: PromptPort = {
  // Tab directory-completion for the vault path (console edge only:
  // the scripted test port and the PromptPort seam are unchanged).
  vaultPath: (message) => directoryInput({ message }),
  authorName: (message, defaultValue) =>
    defaultValue === undefined
      ? input({ message })
      : input({ message, default: defaultValue }),
  authorEmail: (message, defaultValue) =>
    defaultValue === undefined
      ? input({ message })
      : input({ message, default: defaultValue }),
  confirm: (message) => confirm({ message }),
  debounceSeconds: (message, defaultValue) =>
    input({ message, default: String(defaultValue) }),
  syncIntervalMinutes: (message, defaultValue) =>
    input({ message, default: String(defaultValue) }),
};

export interface SetupResult {
  /** The Git work-tree root all three artifacts were written to. */
  root: string;
  vault: string;
  author: { name: string; email: string };
  /** Debounce window in seconds (default 45). */
  debounceSeconds: number;
  /** Pull interval in minutes (default 15). */
  syncIntervalMinutes: number;
  /**
   * Path of a legacy global config (`~/.config/supermemory/config.json`
   * under the injected home) when one exists — surfaced informationally
   * only: it is never read, never imported, never deleted (AD-4).
   */
  legacyConfigPath?: string;
}

const MAX_VAULT_ATTEMPTS = 5;
const MAX_TIMING_ATTEMPTS = 5;

/**
 * Asks for one timing knob until the answer is a whole number within
 * bounds; an empty answer accepts the default. After
 * MAX_TIMING_ATTEMPTS invalid answers the wizard aborts (nothing written).
 */
async function askTiming(
  ask: (message: string, defaultValue: number) => Promise<string>,
  label: string,
  unit: string,
  defaultValue: number,
  bounds: { min: number; max: number },
  isValid: (value: unknown) => boolean,
): Promise<number> {
  const message = `${label} (${unit}, ${bounds.min}-${bounds.max}):`;
  for (let attempt = 0; attempt < MAX_TIMING_ATTEMPTS; attempt += 1) {
    const answer = (await ask(message, defaultValue)).trim();
    if (answer === "") return defaultValue;
    const value = /^\d+$/.test(answer) ? Number(answer) : Number.NaN;
    if (isValid(value)) return value;
  }
  throw new AppError(
    "INVALID_SYNC_SETTING",
    `${label} must be a whole number of ${unit} between ${bounds.min} and ${bounds.max}.`,
    { hint: "Re-run `supermemory setup` and enter a valid value." },
  );
}

const LEGACY_GLOBAL_CONFIG_PATH = (homeDir: string): string =>
  path.join(homeDir, ".config", "supermemory", "config.json");

export async function runSetup(
  prompts: PromptPort,
  io: { basePath: string; homeDir: string },
): Promise<SetupResult> {
  // (0) guards — before ANY prompt or I/O beyond reading the launch
  // directory; a refusal writes nothing. Order matters: the home-root
  // check runs FIRST, so a home directory that happens to be a git
  // repository is still refused (home-as-dotfiles-repo).
  if (io.basePath === io.homeDir) {
    throw new AppError(
      "SETUP_LOCATION_REFUSED",
      `supermemory setup refuses to run in your home directory (${io.basePath}): the home root is not an agent project.`,
      {
        hint: 'cd into the agent project\'s Git work tree (any subdirectory is fine) and re-run "supermemory setup". For vaults used outside any project, pass --vault or set SUPERMEMORY_VAULT.',
      },
    );
  }
  const root = findProjectRoot(io.basePath);
  if (root === undefined) {
    throw new AppError(
      "SETUP_LOCATION_REFUSED",
      `supermemory setup must run inside a Git work tree (${io.basePath} is not one): it writes the project's supermemory.json at the work-tree root.`,
      {
        hint: 'cd into the project where your agent works and re-run "supermemory setup". Inside a subdirectory is fine — setup writes at the work-tree root.',
      },
    );
  }

  // One-time informational legacy hint (AD-4): existence probe only —
  // the file is never read, never imported, never deleted.
  const legacyConfigPath = existsSync(LEGACY_GLOBAL_CONFIG_PATH(io.homeDir))
    ? LEGACY_GLOBAL_CONFIG_PATH(io.homeDir)
    : undefined;

  // (1) vault path — re-prompt until boot validation passes
  let vault: string | undefined;
  let lastError: AppError | undefined;
  for (let attempt = 0; attempt < MAX_VAULT_ATTEMPTS; attempt += 1) {
    const answer = (await prompts.vaultPath(
      "Vault path (a git repository with .memory/rules.md):",
    )).trim();
    if (answer === "") continue;
    const resolved = expandVaultInput(answer, io.homeDir);
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
  const author = { name, email };

  // (2b) sync timing — defaults equal the built-ins (45 s / 15 min)
  const debounceSeconds = await askTiming(
    (m, d) => prompts.debounceSeconds(m, d),
    "Debounce after last write before syncing",
    "seconds",
    DEFAULT_DEBOUNCE_SECONDS,
    DEBOUNCE_SECONDS_BOUNDS,
    isValidDebounceSeconds,
  );
  const syncIntervalMinutes = await askTiming(
    (m, d) => prompts.syncIntervalMinutes(m, d),
    "Pull interval between background syncs",
    "minutes",
    DEFAULT_SYNC_INTERVAL_MINUTES,
    SYNC_INTERVAL_MINUTES_BOUNDS,
    isValidSyncIntervalMinutes,
  );

  // (3) confirm — every write below happens only after confirmation,
  // so a decline (like the 5-attempt abort) writes nothing.
  const ok = await prompts.confirm(
    `Write supermemory.json in ${root} (vault ${vault}, author "${name}" <${email}>)?`,
  );
  if (!ok) {
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      "setup cancelled — nothing was written.",
    );
  }

  // (4) write the three artifacts at the WORK-TREE ROOT (AD-2): the
  // same root `findProjectRoot` resolves for every later launch.
  // Fresh write, never a merge — stale keys do not survive a rerun.
  // Timing keys are written only when they differ from the built-in
  // defaults, so default answers keep supermemory.json byte-identical.
  const content = JSON.stringify(
    {
      vault,
      ...(author !== undefined ? { author } : {}),
      ...(debounceSeconds !== DEFAULT_DEBOUNCE_SECONDS ? { debounceSeconds } : {}),
      ...(syncIntervalMinutes !== DEFAULT_SYNC_INTERVAL_MINUTES
        ? { syncIntervalMinutes }
        : {}),
    },
    null,
    2,
  );
  await writeFile(path.join(root, PROJECT_CONFIG_FILENAME), `${content}\n`, {
    encoding: "utf8",
  });
  // One appended gitignore line — byte-exact N7 semantics via the
  // shared util (AD-5): missing ⇒ appended; present ⇒ no-op; the
  // file's own EOL and every other entry stay untouched.
  await appendMissingLines(path.join(root, ".gitignore"), "supermemory.json\n");
  // The committed onboarding template: created ONLY when absent
  // (exclusive `wx` create + EEXIST tolerance, AD-3) — placeholder
  // bytes, never the answered vault path, never an author identity.
  await writeIfAbsent(
    path.join(root, EXAMPLE_CONFIG_FILENAME),
    EXAMPLE_CONFIG_CONTENT,
  );

  return {
    root,
    vault,
    author,
    debounceSeconds,
    syncIntervalMinutes,
    ...(legacyConfigPath !== undefined ? { legacyConfigPath } : {}),
  };
}

/**
 * Expands a leading `~` to the (injected) home directory and resolves
 * the result to an absolute path. A vault path saved as typed
 * (relative, or with `~` left unexpanded) breaks once supermemory is
 * later launched from a different cwd, or rejects `~` outright since it
 * is shell syntax, not filesystem syntax. The home is a parameter, not
 * `os.homedir()` — the seam rule keeps ambient reads at the commander
 * edge (add-project-config AD-6 rename; was `resolveVaultPath`, which
 * now names the config chain in `config/project-config.ts`).
 */
function expandVaultInput(raw: string, homeDir: string): string {
  if (raw === "~") return homeDir;
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return path.resolve(homeDir, raw.slice(2));
  }
  return path.resolve(raw);
}

/**
 * Creates `filePath` fresh — checked AND enforced atomically via the
 * exclusive `wx` flag (same pattern as `init.ts`'s writeIfAbsent):
 * an existing file (or a lost creation race) is left byte-identical.
 */
async function writeIfAbsent(filePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if (isEexist(err)) return; // already exists — touch nothing
    throw err;
  }
}

function isEexist(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "EEXIST"
  );
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

/**
 * The user-visible completion lines for a successful setup: the
 * completion line, plus EXACTLY ONE legacy-config hint line iff a
 * legacy global config exists (AD-4's pinned, disclosed wording). The
 * wizard never logs — the console binding emits these.
 */
export function setupCompletionLines(result: SetupResult): string[] {
  const lines = [
    `setup complete — project vault: ${result.vault} (author: ${result.author.name})`,
  ];
  if (result.legacyConfigPath !== undefined) {
    lines.push(
      `legacy global config found at ${result.legacyConfigPath} — supermemory no longer reads it. You may delete it manually.`,
    );
  }
  return lines;
}

export type SetupRunner = (io: {
  basePath: string;
  homeDir: string;
}) => Promise<SetupResult>;

/** The production runner: the real wizard over the console prompts. */
export const defaultSetupRunner: SetupRunner = (io) =>
  runSetup(consolePrompts, io);

export function registerSetupCommand(
  program: Command,
  run: SetupRunner = defaultSetupRunner,
): void {
  const log = createLogger();
  program
    .command("setup")
    .description(
      "One-time wizard: point this project's supermemory at your vault and identity.",
    )
    .action(async () => {
      // The commander action is the ambient edge (add-project-config
      // AD-2): it injects the launch directory and the home directory,
      // and owns the completion log + the one legacy-hint line.
      const result = await run({
        basePath: process.cwd(),
        homeDir: os.homedir(),
      });
      for (const line of setupCompletionLines(result)) log.info(line);
    });
}
