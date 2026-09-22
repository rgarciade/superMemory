import path from "node:path";

/**
 * `.memory` layout helpers (design §1.2 / RFC §4.1). The vault is the
 * source of truth; only `.memory/cache/` holds derived state.
 */

export interface VaultPaths {
  root: string;
  memoryDir: string;
  rulesPath: string;
  templatesDir: string;
  configPath: string;
  localJsonPath: string;
  cacheDir: string;
  /** Top-level, Obsidian-visible (not under `.memory/`). */
  conflictsDir: string;
}

export function vaultPaths(root: string): VaultPaths {
  const memoryDir = path.join(root, ".memory");
  return {
    root,
    memoryDir,
    rulesPath: path.join(memoryDir, "rules.md"),
    templatesDir: path.join(memoryDir, "templates"),
    configPath: path.join(memoryDir, "config.yml"),
    localJsonPath: path.join(memoryDir, "local.json"),
    cacheDir: path.join(memoryDir, "cache"),
    conflictsDir: path.join(root, "conflicts"),
  };
}

export function templatePathFor(vaultRoot: string, noteType: string): string {
  return path.join(vaultRoot, ".memory", "templates", `${noteType}.md`);
}

/** True when `child` is strictly inside `parent` (both resolved). */
export function isInsideDir(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel === "") return false; // the parent itself is not "inside"
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}
