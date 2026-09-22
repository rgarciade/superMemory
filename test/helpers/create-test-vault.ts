import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit, type SimpleGit } from "simple-git";

const execFileAsync = promisify(execFile);

/**
 * Hermetic test-vault factory (design §1.6/§1.8).
 *
 * Copies the committed fixture assets from `test/fixtures/vault/` (never a
 * nested `.git`) into `mkdtemp(os.tmpdir())`, runs `git init` with a local
 * identity, `commit.gpgsign false`, and fixed author/committer dates so
 * commits are deterministic. Tests never touch the real HOME or any
 * network.
 */

/** Fixed author/committer dates for deterministic git history. */
export const FIXED_GIT_DATE = "2025-01-01T00:00:00.000Z";

export const FIXTURE_VAULT_DIR = fileURLToPath(
  new URL("../fixtures/vault", import.meta.url),
);

export const VAULT_FOLDERS = [
  "specs",
  "decisions",
  "incidents",
  "learnings",
  "facts",
  "logs",
  "index",
  "conflicts",
] as const;

export type VaultFolder = (typeof VAULT_FOLDERS)[number];

export interface TestVaultPaths {
  root: string;
  memoryDir: string;
  rulesPath: string;
  templatesDir: string;
  configPath: string;
  gitattributesPath: string;
  folders: Record<VaultFolder, string>;
}

export interface SeedNote {
  /** Path relative to the vault root, e.g. "specs/SPEC-x-spec.md". */
  path: string;
  content: string;
}

export interface TestVault {
  root: string;
  paths: TestVaultPaths;
  /** Git handle with fixed dates + local identity already configured. */
  git: SimpleGit;
  /**
   * Register a closeable (e.g. a better-sqlite3 Database handle) that must
   * be closed before the tree is deleted on cleanup.
   */
  onClose(close: () => void): void;
  /** Write a file inside the vault (mkdir -p on parent). */
  write(relPath: string, content: string): Promise<string>;
  /** Commit all changes with the fixed date. */
  commit(message: string): Promise<void>;
  /** Runs registered closers, then deletes the whole tmp tree. */
  cleanup(): Promise<void>;
}

export async function createTestVault(
  opts: { seedNotes?: SeedNote[] } = {},
): Promise<TestVault> {
  const root = await mkdtemp(path.join(os.tmpdir(), "supermemory-vault-"));
  const closers: Array<() => void> = [];

  await cp(FIXTURE_VAULT_DIR, root, { recursive: true });

  const git = simpleGit(root);
  await git.init();
  await git.addConfig("user.name", "Test User");
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("commit.gpgsign", "false");

  if (opts.seedNotes && opts.seedNotes.length > 0) {
    for (const note of opts.seedNotes) {
      await writeVaultFile(root, note.path, note.content);
    }
  }

  await git.add(".");
  await commitWithFixedDates(root, "test: fixture vault baseline");

  const paths: TestVaultPaths = {
    root,
    memoryDir: path.join(root, ".memory"),
    rulesPath: path.join(root, ".memory", "rules.md"),
    templatesDir: path.join(root, ".memory", "templates"),
    configPath: path.join(root, ".memory", "config.yml"),
    gitattributesPath: path.join(root, ".gitattributes"),
    folders: Object.fromEntries(
      VAULT_FOLDERS.map((f) => [f, path.join(root, f)]),
    ) as Record<VaultFolder, string>,
  };

  return {
    root,
    paths,
    git,
    onClose: (close) => {
      closers.push(close);
    },
    write: (relPath, content) => writeVaultFile(root, relPath, content),
    commit: async (message) => {
      await git.add(".");
      await commitWithFixedDates(root, message);
    },
    cleanup: async () => {
      for (const close of closers) {
        try {
          close();
        } catch {
          // best-effort: cleanup must proceed even if a handle double-closes
        }
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_DATE: FIXED_GIT_DATE,
    GIT_COMMITTER_DATE: FIXED_GIT_DATE,
  };
}

/**
 * Commits with fixed author/committer dates. simple-git 3.x exposes no
 * public env seam, so this uses a scoped execFile env — process.env is
 * never mutated (design §1.8).
 */
async function commitWithFixedDates(root: string, message: string): Promise<void> {
  await execFileAsync("git", ["commit", "-m", message], {
    cwd: root,
    env: gitEnv(),
  });
}

async function writeVaultFile(
  root: string,
  relPath: string,
  content: string,
): Promise<string> {
  const abs = path.join(root, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  return abs;
}
