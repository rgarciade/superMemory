import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ENV_KEYS, readString, type EnvSource } from "./env.js";
import { AppError, NO_VAULT_CONFIGURED_MESSAGE } from "../util/errors.js";

/**
 * Per-project local config (`supermemory.json` at the nearest Git
 * work-tree root — add-project-config AD-1/AD-6; specs/project-config).
 *
 * This module owns the single vault resolution chain shared by
 * `serve`/`sync`/`resolve`, the fail-safe loader, and the author
 * extraction. There is NO global config anymore: the chain ends in the
 * byte-pinned NO_VAULT_CONFIGURED error.
 *
 * Seam rule: ambient `process.cwd()`/`os.homedir()` never appear here —
 * every entry point takes an explicit `basePath` (injected by the
 * commander edges), so tests are hermetic by construction. The loader
 * touches only the `basePath` work tree, never HOME.
 */

export const PROJECT_CONFIG_FILENAME = "supermemory.json";
export const EXAMPLE_CONFIG_FILENAME = "supermemory.example.json";
export const EXAMPLE_CONFIG_CONTENT =
  '{\n  "vault": "/absolute/path/to/your/vault"\n}\n';

/** Flat per-project shape (spec: vault REQUIRED absolute; author OPTIONAL). */
export interface ProjectConfig {
  vault: string;
  author?: { name: string; email: string };
}

/** The project author as a CommitAuthor-compatible value (structural — no sync/ import). */
export interface ProjectAuthor {
  name: string;
  email: string;
}

/**
 * Nearest enclosing Git work-tree root from `basePath` (`.git` dir or
 * file — linked worktrees and submodules mark their own root);
 * undefined outside any work tree. Pure fs `stat` walk, no subprocess.
 * Nearest-root-only: no ancestor beyond the first work tree is consulted.
 */
export function findProjectRoot(basePath: string): string | undefined {
  let current = path.resolve(basePath);
  for (;;) {
    if (hasGitMarker(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined; // filesystem root reached
    current = parent;
  }
}

function hasGitMarker(dir: string): boolean {
  try {
    const stat = statSync(path.join(dir, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

/** Absolute path of the project config for a launch location; undefined outside any work tree. */
export function projectConfigPath(basePath: string): string | undefined {
  const root = findProjectRoot(basePath);
  return root === undefined ? undefined : path.join(root, PROJECT_CONFIG_FILENAME);
}

/**
 * Load and validate the project config. FAIL-SAFE (spec-frozen): absent
 * file, unreadable file, JSON parse error, non-object root, missing /
 * non-string / non-absolute `vault` ⇒ `undefined` — resolution then
 * behaves exactly as if no file existed and ends in the pinned
 * NO_VAULT_CONFIGURED error. Never throws for file content. A malformed
 * optional `author` is dropped (vault still honored); unknown keys are
 * ignored.
 */
export async function loadProjectConfig(
  basePath: string,
): Promise<ProjectConfig | undefined> {
  const file = projectConfigPath(basePath);
  if (file === undefined) return undefined;

  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return undefined; // absent or unreadable ⇒ unconfigured
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined; // corrupt ⇒ unconfigured, never a parse crash
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined; // non-object root
  }
  const record = parsed as Record<string, unknown>;

  const vault = record["vault"];
  if (typeof vault !== "string" || !path.isAbsolute(vault)) {
    return undefined; // missing / non-string / relative ⇒ unconfigured
  }

  const author = parseOptionalAuthor(record["author"]);
  return author === undefined ? { vault } : { vault, author };
}

/**
 * The project author, or undefined when absent/malformed (name and
 * email must both be non-empty strings). Structurally typed — assignable
 * to the sync engine's CommitAuthor by structure, with no `sync/` import.
 */
export function projectAuthor(
  config: ProjectConfig | undefined,
): ProjectAuthor | undefined {
  return config === undefined ? undefined : parseOptionalAuthor(config.author);
}

function parseOptionalAuthor(raw: unknown): ProjectAuthor | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const name = record["name"];
  const email = record["email"];
  if (
    typeof name !== "string" ||
    name === "" ||
    typeof email !== "string" ||
    email === ""
  ) {
    return undefined;
  }
  return { name, email };
}

/**
 * THE resolution chain (spec-frozen order): vaultFlag → SUPERMEMORY_VAULT
 * → project file at findProjectRoot(basePath) → AppError
 * NO_VAULT_CONFIGURED with the exact message
 * "No vault configured. Run: supermemory setup".
 */
export async function resolveVaultPath(input: {
  vaultFlag?: string;
  env: EnvSource;
  basePath: string;
}): Promise<string> {
  if (input.vaultFlag) return input.vaultFlag;

  const fromEnv = readString(input.env, ENV_KEYS.vault);
  if (fromEnv) return fromEnv;

  const config = await loadProjectConfig(input.basePath);
  if (config !== undefined) return config.vault;

  throw new AppError("NO_VAULT_CONFIGURED", NO_VAULT_CONFIGURED_MESSAGE, {
    hint: "Run `supermemory setup` in the project, or for a vault used outside any project pass --vault or set SUPERMEMORY_VAULT.",
  });
}
