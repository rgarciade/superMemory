import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../util/errors.js";
import { resolveNoteType } from "../index/build.js";
import { parseNoteFile } from "../notes/parse.js";
import type { RulesModel } from "../rules/types.js";
import { assertNoSecrets } from "./secrets.js";
import {
  deriveCommitMessage,
  formatCommitMessage,
  withConflictResolvedSuffix,
} from "./commit-message.js";
import { readConflictNotes, type ConflictNoteRecord } from "./conflict-note.js";
import type { CommitAuthor, GitClient } from "./git.js";

// Re-exported: resolve's public surface (listOpenConflicts, the prompt
// context, outcomes) hands these records back to callers.
export type { ConflictNoteRecord };

/**
 * Guided conflict resolution (design §4.4 step 5, task 3.10) — the
 * human half of the curated ladder path. The engine aborts the rebase,
 * snapshots the incoming side on `conflict/<date>-<note-id>`, and writes
 * a conflict note into the vault; this module is what
 * `supermemory resolve` runs:
 *
 * 1. **List** open conflicts from the conflict notes (`status: open`).
 * 2. **Materialize** both sides side by side next to the conflict note:
 *    `<note>.local.md` from the working tree, `<note>.remote.md`
 *    extracted from the snapshot branch.
 * 3. **Prompt** the human to merge into the real note path and confirm
 *    — through the injectable `ResolvePromptPort`. This module never
 *    touches `@inquirer/prompts`; the CLI entry (3.12) binds the real
 *    console prompt at the edge, exactly like `setup`.
 * 4. **Finalize**: integrate the diverged remote, commit the merged
 *    note as `note(update): … (conflict resolved)` (shared grammar,
 *    human author), push, flip the conflict note to
 *    `status: resolved`. The snapshot branch is RETAINED — the audit
 *    trail stays recoverable (deletion is a destructive act with no M1
 *    need).
 *
 * Why finalize pulls before committing (design fidelity note): the
 * curated path ABORTED the rebase, so local and origin have diverged —
 * a blind `git push` would be rejected as non-fast-forward. Finalize
 * therefore runs the pull-rebase FIRST and settles the replayed local
 * commit by taking the LOCAL side (during a rebase, `--theirs` is the
 * commit being replayed — the local edits), then commits the merged
 * note on top, making the push a fast-forward. Nothing is lost: the
 * merged note is the human's decision over both sides, and the
 * snapshot branch still holds the incoming side verbatim (never
 * silently delete).
 *
 * Secrets lint runs at finalization BEFORE anything is written,
 * committed, or pushed (design §4.6 — every ladder stage that creates
 * a commit).
 *
 * Locking is the CALLER's job (design §4.5): the server's engine holds
 * the lock for its lifetime; the CLI entry acquires per invocation.
 */

/** Largest settle rounds for the finalize pull-rebase (mirrors the engine's ladder cap). */
const MAX_SETTLE_ROUNDS = 5;

/** What the prompt port shows the human for one conflict. */
export interface MergePromptContext {
  noteId: string;
  /** Vault-relative path the merged note must land on. */
  notePath: string;
  /** Absolute paths of the materialized sides (next to the conflict note). */
  localPath: string;
  remotePath: string;
  localContent: string;
  remoteContent: string;
}

/**
 * The injectable human seam. `mergeSides` presents both sides and
 * returns the merged content — or `null` when the human declines this
 * conflict (skipped, still open). `confirmFinalize` gates the commit +
 * push.
 */
export interface ResolvePromptPort {
  mergeSides(context: MergePromptContext): Promise<string | null>;
  confirmFinalize(context: MergePromptContext): Promise<boolean>;
}

export interface ResolveDeps {
  vaultPath: string;
  rules: RulesModel;
  git: GitClient;
  prompt: ResolvePromptPort;
  /** The human identity — commit author, never the machine (design §4.3). */
  author?: CommitAuthor;
  /** Agent/client provenance trailer (defaults to `cli`). */
  via?: string;
}

export interface MaterializedSides {
  localPath: string;
  remotePath: string;
  localContent: string;
  remoteContent: string;
}

export type ResolveResult = "resolved" | "skipped" | "failed";

export interface ResolveOutcome {
  noteId: string;
  notePath: string;
  result: ResolveResult;
  /** Set on `resolved` — the finalize commit's sha. */
  commitSha?: string;
  /** Set on `failed` — the AppError code (e.g. SECRETS_BLOCKED). */
  code?: string;
  /** Set on `skipped`/`failed` — why. */
  reason?: string;
}

export interface ResolveReport {
  outcomes: ResolveOutcome[];
}

/** Open conflicts only — resolved ones stay in the vault as history. */
export async function listOpenConflicts(conflictsDir: string): Promise<ConflictNoteRecord[]> {
  const all = await readConflictNotes(conflictsDir);
  return all.filter((record) => record.status === "open");
}

/**
 * Writes `<note>.local.md` (working tree) and `<note>.remote.md` (the
 * snapshot branch) next to the conflict note, and returns their paths
 * and contents for the prompt.
 */
export async function materializeConflictSides(
  deps: Pick<ResolveDeps, "vaultPath" | "git">,
  record: ConflictNoteRecord,
): Promise<MaterializedSides> {
  const localAbs = path.join(deps.vaultPath, record.notePath);
  let localContent: string;
  try {
    localContent = await readFile(localAbs, "utf8");
  } catch {
    throw new AppError(
      "CONFLICT_CURATED",
      `the local side of the conflict is gone: ${record.notePath}`,
      {
        hint: `The conflict note references a note that no longer exists. Resolve manually (snapshot branch: ${record.snapshotBranch}) or delete the conflict note.`,
      },
    );
  }
  let remoteContent: string;
  try {
    remoteContent = await deps.git.showFile(record.snapshotBranch, record.notePath);
  } catch {
    throw new AppError(
      "CONFLICT_CURATED",
      `the snapshot branch is unreadable: ${record.snapshotBranch}:${record.notePath}`,
      {
        hint: "The conflict note references a missing snapshot branch. Resolve manually or delete the conflict note.",
      },
    );
  }
  // Both sides live next to the conflict note, named after THE NOTE.
  const sidesDir = path.dirname(record.path);
  const base = path.basename(record.notePath).replace(/\.md$/i, "");
  const localPath = path.join(sidesDir, `${base}.local.md`);
  const remotePath = path.join(sidesDir, `${base}.remote.md`);
  await writeFile(localPath, localContent, "utf8");
  await writeFile(remotePath, remoteContent, "utf8");
  return { localPath, remotePath, localContent, remoteContent };
}

/**
 * Finalizes one conflict with the human's merged content: lint →
 * integrate the diverged remote (settle with the local side) → write
 * the merged note → commit with the shared grammar → push → flip the
 * conflict note. Throws on blocked secrets or a failed push — the
 * conflict note stays open and local state is intact.
 */
export async function finalizeResolution(
  deps: ResolveDeps,
  record: ConflictNoteRecord,
  mergedContent: string,
): Promise<{ commitSha: string }> {
  // Lint BEFORE anything touches disk, git, or the network (design §4.6).
  assertNoSecrets(record.notePath, mergedContent);

  // Integrate the diverged remote so the finalize push is a
  // fast-forward. The rebase replays the pre-conflict local commits;
  // each conflict is settled with the LOCAL side (--theirs during a
  // rebase IS the replayed local commit) — the merged note, committed
  // next, is the human's decision over both sides, and the snapshot
  // branch keeps the incoming side recoverable.
  await pullAndSettleLocal(deps.git);

  await writeFile(path.join(deps.vaultPath, record.notePath), mergedContent, "utf8");

  const resolved = resolveNoteType(record.notePath, deps.rules);
  const type = resolved?.type ?? path.basename(record.notePath).replace(/\.md$/i, "");
  const def = resolved?.def;
  const parsed = parseNoteFile(mergedContent);
  // No prevFrontmatter: the resolution suffix IS this update's
  // meaningful change (design §4.4 — `note(update): … (conflict resolved)`).
  const message = withConflictResolvedSuffix(
    deriveCommitMessage({
      op: "update",
      type,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      fileName: path.basename(record.notePath),
      ...(def !== undefined ? { noteTypeDef: def } : {}),
      ...(deps.author !== undefined ? { author: deps.author.name } : {}),
      via: deps.via ?? "cli",
    }),
  );
  await deps.git.add([record.notePath]);
  const commitSha = await deps.git.commit({
    message: formatCommitMessage(message),
    ...(deps.author !== undefined ? { author: deps.author } : {}),
    paths: [record.notePath],
  });

  // Push never forces (the wrapper exposes no force API at all).
  await deps.git.push();

  await flipConflictNoteStatus(record.path);

  return { commitSha };
}

/**
 * `pull --rebase --autostash`, settling every conflict with the LOCAL
 * side (the replayed commit — `--theirs` during a rebase). A pull that
 * fails WITHOUT conflicts (network) propagates: finalize must not
 * pretend to have pushed.
 */
async function pullAndSettleLocal(git: GitClient): Promise<void> {
  try {
    await git.pullRebaseAutostash();
    return;
  } catch {
    // fall through: expect a rebase in progress with conflicts
  }
  for (let round = 0; round < MAX_SETTLE_ROUNDS; round++) {
    const status = await git.status();
    if (status.conflicted.length === 0) {
      // Settled — or the pull failed without starting one (e.g.
      // network); the push below surfaces that as a failed outcome.
      return;
    }
    await git.checkoutTheirs(status.conflicted);
    await git.add(status.conflicted);
    await git.rebaseContinue();
  }
  const final = await git.status();
  if (final.conflicted.length > 0) {
    throw new AppError(
      "CONFLICT_CURATED",
      `the finalize rebase did not settle after ${MAX_SETTLE_ROUNDS} rounds — local state is intact`,
      { hint: "Resolve with plain git, then run supermemory resolve again." },
    );
  }
}

/**
 * The full guided flow over every open conflict (design §4.4 step 5):
 * list → materialize → prompt → finalize, one conflict at a time in the
 * conflict notes' deterministic (name-sorted) order. One conflict's
 * failure or skip never stops the others — outcomes are reported per
 * conflict (the spec's "status no longer reports the conflict" reads
 * the flipped notes, so a skipped conflict stays visible).
 */
export async function runResolve(deps: ResolveDeps): Promise<ResolveReport> {
  const conflictsDir = path.join(deps.vaultPath, "conflicts");
  const open = await listOpenConflicts(conflictsDir);
  const outcomes: ResolveOutcome[] = [];
  for (const record of open) {
    outcomes.push(await resolveOne(deps, record));
  }
  return { outcomes };
}

async function resolveOne(
  deps: ResolveDeps,
  record: ConflictNoteRecord,
): Promise<ResolveOutcome> {
  try {
    const sides = await materializeConflictSides(deps, record);
    const context: MergePromptContext = {
      noteId: record.noteId,
      notePath: record.notePath,
      localPath: sides.localPath,
      remotePath: sides.remotePath,
      localContent: sides.localContent,
      remoteContent: sides.remoteContent,
    };
    const merged = await deps.prompt.mergeSides(context);
    if (merged === null) {
      return { noteId: record.noteId, notePath: record.notePath, result: "skipped", reason: "merge declined" };
    }
    const confirmed = await deps.prompt.confirmFinalize(context);
    if (!confirmed) {
      return { noteId: record.noteId, notePath: record.notePath, result: "skipped", reason: "finalize not confirmed" };
    }
    const { commitSha } = await finalizeResolution(deps, record, merged);
    return { noteId: record.noteId, notePath: record.notePath, result: "resolved", commitSha };
  } catch (err) {
    return {
      noteId: record.noteId,
      notePath: record.notePath,
      result: "failed",
      ...(err instanceof AppError ? { code: err.code } : {}),
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Flips the conflict note's frontmatter to `status: resolved` — on
 * disk only (design order: commit, push, flip). Idempotent: an already
 * resolved note is left untouched.
 */
async function flipConflictNoteStatus(noteAbsPath: string): Promise<void> {
  const raw = await readFile(noteAbsPath, "utf8");
  if (!raw.includes("status: open")) return; // already flipped (or hand-edited)
  await writeFile(noteAbsPath, raw.replace("status: open", "status: resolved"), "utf8");
}
