import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { simpleGit, type SimpleGit } from "simple-git";

const execFileAsync = promisify(execFile);

/**
 * Hermetic git-remote helpers (design §1.8): a bare repo in tmp as the
 * stand-in for GitHub, clones wired over local paths, and a
 * divergent-clones helper (local ahead AND remote ahead on the same note
 * region) for the P3 conflict-ladder tests. No network, ever.
 */

export interface RemoteRepo {
  /** Local path of the bare repo — use as the clone URL. */
  url: string;
  cleanup(): Promise<void>;
}

export interface Clone {
  root: string;
  /** simple-git handle with local identity + gpgsign off configured. */
  git: SimpleGit;
  write(relPath: string, content: string): Promise<string>;
  commit(message: string): Promise<void>;
  cleanup(): Promise<void>;
}

/** `git init --bare` in a fresh tmp dir. */
export async function createRemote(name = "origin"): Promise<RemoteRepo> {
  const url = await mkdtemp(path.join(os.tmpdir(), `supermemory-${name}-`));
  const git = simpleGit(url);
  await git.raw(["init", "--bare", "--initial-branch=main", url]);
  return {
    url,
    cleanup: () => rm(url, { recursive: true, force: true }),
  };
}

/** Clone a remote over its local path, with local identity + gpgsign off. */
export async function createClone(url: string, name = "clone"): Promise<Clone> {
  const root = await mkdtemp(path.join(os.tmpdir(), `supermemory-${name}-`));
  const git = simpleGit(root);
  await git.clone(url, root);
  await git.addConfig("user.name", "Test User");
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("commit.gpgsign", "false");
  return {
    root,
    git,
    write: (relPath, content) => writeCloneFile(root, relPath, content),
    commit: async (message) => {
      await git.add(".");
      await git.commit(message);
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export interface DivergentClones {
  /** The "local" clone: ahead of the remote with `localContent`. */
  local: Clone;
  /** The "remote-side" clone: its HEAD was pushed, ahead with `remoteContent`. */
  remote: Clone;
  url: string;
  /** Clean up the local clone, the remote-side clone, and the bare repo. */
  cleanup(): Promise<void>;
}

/**
 * Creates two divergent clones of one bare remote, both ahead of each
 * other on the same note region: `baseContent` is seeded and pushed, then
 * `remoteContent` is committed+pushed from the remote-side clone while
 * `localContent` is committed (not pushed) from the local clone. The next
 * `pull --rebase` from the local clone is exactly the conflict scenario
 * the P3 ladder resolves.
 */
export async function createDivergentClones(opts: {
  notePath: string;
  baseContent: string;
  localContent: string;
  remoteContent: string;
}): Promise<DivergentClones> {
  const remoteRepo = await createRemote();
  const remote = await createClone(remoteRepo.url, "remote-side");

  await remote.write(opts.notePath, opts.baseContent);
  await remote.commit("test: seed base note");
  await remote.git.push("origin", "main");

  const local = await createClone(remoteRepo.url, "local");

  await remote.write(opts.notePath, opts.remoteContent);
  await remote.commit("test: remote-side edit");
  await remote.git.push("origin", "main");

  // Make the local clone's origin/main ref current so divergence is
  // observable (rev-list main..origin/main) without an explicit pull.
  await local.git.fetch("origin");

  await local.write(opts.notePath, opts.localContent);
  await local.commit("test: local-side edit");

  return {
    local,
    remote,
    url: remoteRepo.url,
    cleanup: async () => {
      await local.cleanup();
      await remote.cleanup();
      await remoteRepo.cleanup();
    },
  };
}

async function writeCloneFile(
  root: string,
  relPath: string,
  content: string,
): Promise<string> {
  const abs = path.join(root, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  return abs;
}

export async function isBareRepo(url: string): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--is-bare-repository"],
    { cwd: url },
  );
  return stdout.trim() === "true";
}
