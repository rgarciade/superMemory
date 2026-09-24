import { simpleGit, type SimpleGit, type StatusResult } from "simple-git";

/**
 * The typed, thin git surface the sync engine is allowed to use
 * (design §4.1). Deliberately narrow:
 *
 * - `pull` is always `--rebase --autostash` — there is no merge-commit
 *   or plain-pull path to drift onto.
 * - `push` is a plain push. **No force API is exposed at all** — the
 *   sync-ladder spec forbids force-push ("History is never rewritten by
 *   force"), so it is not merely discouraged here, it is unreachable.
 * - `rebaseAbort`/`rebaseContinue` exist for the conflict ladder's
 *   curated path (abort, snapshot) and the generated path (continue).
 *
 * Everything else stays on simple-git directly; this wrapper adds no
 * logic beyond typed shapes and the safety constraints above.
 */

export interface CommitAuthor {
  name: string;
  email: string;
}

export interface GitCommitInput {
  /** Full message: header + blank line + trailer block (formatCommitMessage). */
  message: string;
  /** The human identity — git author, so blame shows people (design §4.3). */
  author?: CommitAuthor;
  /** Restrict the commit to these paths (already added unless listed here). */
  paths?: string[];
}

export interface GitStatus {
  clean: boolean;
  /** Staged (index) changes, relative paths. */
  staged: string[];
  /** Unstaged working-tree changes to tracked files. */
  changed: string[];
  untracked: string[];
  /** Files in a merge/rebase conflict state (porcelain x/y in U/A/D combos). */
  conflicted: string[];
}

export interface GitClient {
  status(): Promise<GitStatus>;
  add(paths: string[]): Promise<void>;
  /** Returns the new commit's sha. */
  commit(input: GitCommitInput): Promise<string>;
  /** `git pull --rebase --autostash`; returns git's raw output. */
  pullRebaseAutostash(remote?: string, branch?: string): Promise<string>;
  /** Plain push only — never force (unreachable by design). */
  push(remote?: string, branch?: string): Promise<void>;
  /** Content of `path` as of `ref` — e.g. `git show HEAD:<path>` for deletion derivation. */
  showFile(ref: string, relPath: string): Promise<string>;
  /** Resolves a ref to a sha (default HEAD) — the engine's pull-diff bookkeeping. */
  revParse(ref?: string): Promise<string>;
  /** Paths changed between two refs — the pull's changed files for IndexPort.reparse. */
  diffNames(fromRef: string, toRef: string): Promise<string[]>;
  /** `git checkout --theirs <paths>` — the ladder's generated-file resolution. */
  checkoutTheirs(paths: string[]): Promise<void>;
  /** Creates a branch at `ref` (default HEAD) — the ladder's snapshot branches. */
  createBranch(name: string, ref?: string): Promise<void>;
  rebaseAbort(): Promise<void>;
  rebaseContinue(): Promise<void>;
}

export type GitFactory = (dir: string) => SimpleGit;

/**
 * The wrapper's default instance opts into `allowUnsafeEditor` — the
 * narrow simple-git escape that permits *setting an editor at all* —
 * because `rebaseContinue` pins `GIT_EDITOR` to a no-op (`true`) itself:
 * in a tty-less process (the server) git's default editor would block
 * the rebase forever. No other unsafe category is enabled.
 */
function createDefaultGitFactory(): GitFactory {
  return (dir: string) =>
    simpleGit(dir, { unsafe: { allowUnsafeEditor: true } });
}

export function createGitClient(
  vaultPath: string,
  gitFactory: GitFactory = createDefaultGitFactory(),
): GitClient {
  const git = gitFactory(vaultPath);
  return {
    async status(): Promise<GitStatus> {
      const result = await git.status();
      return toGitStatus(result);
    },

    async add(paths: string[]): Promise<void> {
      await git.add(paths);
    },

    async commit(input: GitCommitInput): Promise<string> {
      const options =
        input.author !== undefined
          ? { "--author": `${input.author.name} <${input.author.email}>` }
          : undefined;
      const result =
        input.paths !== undefined && input.paths.length > 0
          ? await git.commit(input.message, input.paths, options)
          : await git.commit(input.message, options);
      return result.commit;
    },

    async pullRebaseAutostash(remote?: string, branch?: string): Promise<string> {
      const args = ["pull", "--rebase", "--autostash"];
      if (remote !== undefined) args.push(remote);
      if (remote !== undefined && branch !== undefined) args.push(branch);
      const result = await git.raw(args);
      return result.trim();
    },

    async push(remote = "origin", branch?: string): Promise<void> {
      const args = ["push", remote];
      if (branch !== undefined) args.push(branch);
      await git.raw(args);
    },

    async showFile(ref: string, relPath: string): Promise<string> {
      return git.raw(["show", `${ref}:${relPath}`]);
    },

    async revParse(ref = "HEAD"): Promise<string> {
      const out = await git.raw(["rev-parse", ref]);
      return out.trim();
    },

    async diffNames(fromRef: string, toRef: string): Promise<string[]> {
      const out = await git.raw(["diff", "--name-only", fromRef, toRef]);
      return out
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
    },

    async checkoutTheirs(paths: string[]): Promise<void> {
      if (paths.length === 0) return;
      await git.raw(["checkout", "--theirs", ...paths]);
    },

    async createBranch(name: string, ref?: string): Promise<void> {
      const args = ["branch", name];
      if (ref !== undefined) args.push(ref);
      await git.raw(args);
    },

    async rebaseAbort(): Promise<void> {
      await git.raw(["rebase", "--abort"]);
    },

    async rebaseContinue(): Promise<void> {
      // `git rebase --continue` may spawn an editor to confirm the
      // replayed commit's message; in a tty-less process (the server)
      // that would block forever. Pin a no-op editor for this instance.
      git.env("GIT_EDITOR", "true");
      await git.raw(["rebase", "--continue"]);
    },
  };
}

function toGitStatus(result: StatusResult): GitStatus {
  const staged: string[] = [];
  const changed: string[] = [];
  const untracked: string[] = [];
  const conflicted: string[] = [];
  for (const file of result.files) {
    if (isConflicted(file.index, file.working_dir)) {
      conflicted.push(file.path);
      continue;
    }
    const isUntracked = file.index === "?" || file.working_dir === "?";
    if (isUntracked) {
      untracked.push(file.path);
      continue;
    }
    if (file.index !== " ") staged.push(file.path);
    if (file.working_dir !== " ") changed.push(file.path);
  }
  return {
    clean: result.files.length === 0,
    staged,
    changed,
    untracked,
    conflicted,
  };
}

/** Porcelain conflict codes: any `U` position, or both sides added/deleted (AA/DD). */
function isConflicted(index: string, workingDir: string): boolean {
  return (
    index === "U" ||
    workingDir === "U" ||
    (index === "A" && workingDir === "A") ||
    (index === "D" && workingDir === "D")
  );
}
