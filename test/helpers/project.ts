import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  EXAMPLE_CONFIG_FILENAME,
  PROJECT_CONFIG_FILENAME,
} from "../../src/config/project-config.js";

const execFileAsync = promisify(execFile);

/**
 * Hermetic test-project factory (design §6, add-project-config AD-1/AD-6).
 *
 * Creates a throwaway Git work tree in `mkdtemp(os.tmpdir())` — the
 * `.git` marker is what `findProjectRoot` discovers, so a bare
 * `git init` (no commits, no identity, no network) is the fixture's
 * backbone. Optional artifacts are pre-placed so each test states
 * exactly the starting state it reasons about. Tests never chdir,
 * never touch the real HOME, and never mutate `process.env`.
 */

/** A throwaway project work tree; `cleanup()` removes every byte. */
export interface TestProject {
  /** The Git work-tree root (what `findProjectRoot` must resolve to). */
  root: string;
  /** The created subdirectory when `nested` was requested. */
  subdir?: string;
  /** Removes the whole tree (recursive, force). */
  cleanup(): Promise<void>;
}

export interface MakeProjectDirOptions {
  /** JSON-serialized (2-space indent + trailing newline) to `{root}/supermemory.json`. */
  config?: unknown;
  /** Pre-placed `supermemory.example.json` bytes (e.g. a committed template). */
  example?: string;
  /** Pre-placed `.gitignore` bytes (LF or CRLF). */
  gitignore?: string;
  /** Subdirectory to create (relative to root, may contain segments); returned as `subdir`. */
  nested?: string;
}

export async function makeProjectDir(
  opts: MakeProjectDirOptions = {},
): Promise<TestProject> {
  const root = await mkdtemp(path.join(os.tmpdir(), "sm-project-"));
  await execFileAsync("git", ["init", "--quiet", root]);

  if (opts.config !== undefined) {
    await writeFile(
      path.join(root, PROJECT_CONFIG_FILENAME),
      `${JSON.stringify(opts.config, null, 2)}\n`,
      "utf8",
    );
  }
  if (opts.example !== undefined) {
    await writeFile(path.join(root, EXAMPLE_CONFIG_FILENAME), opts.example, "utf8");
  }
  if (opts.gitignore !== undefined) {
    await writeFile(path.join(root, ".gitignore"), opts.gitignore, "utf8");
  }

  let subdir: string | undefined;
  if (opts.nested !== undefined) {
    subdir = path.join(root, opts.nested);
    await mkdir(subdir, { recursive: true });
  }

  return {
    root,
    ...(subdir !== undefined ? { subdir } : {}),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
