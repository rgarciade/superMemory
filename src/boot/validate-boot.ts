import { existsSync, readFileSync, realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { AppError } from "../util/errors.js";
import { isSameOrInsideDir } from "../util/paths.js";
import { checkFormatVersion } from "../rules/version.js";

/**
 * Boot-time vault validation (RFC §3, boot-validation spec): five
 * ordered, fail-fast checks. The first failure aborts with a per-check
 * AppError naming what failed and a concrete next action; the server
 * must never serve a partial catalog against an invalid vault.
 *
 *   1. the path is an existing directory
 *   2. it is a git repository
 *   3. it contains .memory/rules.md
 *   4. it is NOT inside the supermemory source repository
 *   5. its rules.md declares a supported format_version
 */

export interface BootValidationOk {
  ok: true;
}

export async function validateBoot(
  vaultPath: string): Promise<BootValidationOk> {
  // (1) existing directory
  let isDir = false;
  try {
    isDir = (await stat(vaultPath)).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      `vault path "${vaultPath}" is not an existing directory.`,
      { hint: "Check the path (absolute, or relative to where you launch supermemory)." },
    );
  }

  // (2) git repository
  if (!existsSync(path.join(vaultPath, ".git"))) {
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      `vault "${vaultPath}" is not a git repository.`,
      { hint: "Run `git init` inside the vault (or clone the team vault) first." },
    );
  }

  // (3) .memory/rules.md present
  const rulesPath = path.join(vaultPath, ".memory", "rules.md");
  if (!existsSync(rulesPath)) {
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      `vault "${vaultPath}" is missing ${rulesPath}.`,
      { hint: "Run `supermemory init` inside the vault to scaffold .memory/rules.md." },
    );
  }

  // (4) not inside (or equal to) the supermemory source repository —
  // guards against committing private team notes to the public app repo.
  assertVaultOutsideAppRepo(vaultPath);

  // (5) supported format_version (same check boot and sync share)
  let content: string;
  try {
    content = await readFile(rulesPath, "utf8");
  } catch (err) {
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      `vault rules at ${rulesPath} could not be read.`,
      { cause: err },
    );
  }
  const { data: frontmatter } = matter(content);
  const declared = frontmatter["format_version"];
  checkFormatVersion(
    typeof declared === "string" || typeof declared === "number"
      ? declared
      : undefined,
  );

  return { ok: true };
}

/**
 * Throws when `vaultPath` IS the supermemory source repository root, or
 * lives inside it. Both sides are resolved with `realpathSync.native`
 * — a bare string/prefix comparison (or `isInsideDir`'s "the parent
 * itself is not inside" contract, used as-is) would let a symlink
 * alias, a case variant, or `vaultPath === appRoot` (e.g. `supermemory
 * init` run from the app repo root, defaulting to ".") through
 * undetected. `realpathSync.native` (the OS syscall) is used instead of
 * the plain JS `realpathSync`, which preserves input case even on a
 * case-insensitive-but-case-preserving filesystem (macOS APFS default,
 * Windows) — a differently-cased path to the exact same directory would
 * otherwise compare unequal and bypass the guard. Callable standalone
 * so callers that must write nothing to disk before this guard passes
 * (e.g. `initVault`) can run it first.
 */
export function assertVaultOutsideAppRepo(vaultPath: string): void {
  const appRoot = realpathSync.native(appRepoRoot());
  let resolvedVaultPath: string;
  try {
    resolvedVaultPath = realpathSync.native(vaultPath);
  } catch (err) {
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      `vault path "${vaultPath}" could not be resolved.`,
      { cause: err },
    );
  }
  if (isSameOrInsideDir(appRoot, resolvedVaultPath)) {
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      `vault "${vaultPath}" is inside the supermemory source repository (${appRoot}) — vaults must not live inside the app repo, or private notes end up committed to a public repository.`,
      { hint: "Move the vault outside the app repository (e.g. ~/memory-vault) and point setup at it." },
    );
  }
}

/**
 * The supermemory source root, found by walking up from this module to
 * the package.json named "supermemory". Works from src/ (dev/tests) and
 * dist/ (installed binary) alike.
 */
export function appRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
        };
        if (pkg.name === "supermemory") return dir;
      } catch {
        // unreadable package.json — keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}
