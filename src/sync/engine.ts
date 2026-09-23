import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SyncTunables } from "../config/vault-config.js";
import { resolveNoteType } from "../index/build.js";
import type { IndexStore } from "../index/store.js";
import { deriveNoteId, parseNoteFile } from "../notes/parse.js";
import type { WriteEvent } from "../notes/save-pipeline.js";
import type { NoteTypeDef, RulesModel } from "../rules/types.js";
import { checkFormatVersion } from "../rules/version.js";
import type { Clock, TimerPort } from "../util/clock.js";
import { AppError } from "../util/errors.js";
import {
  conflictNoteCommitHeader,
  deriveCommitMessage,
  formatCommitMessage,
} from "./commit-message.js";
import {
  conflictSnapshotBranchName,
  readConflictNotes,
  writeConflictNote,
} from "./conflict-note.js";
import { createGitClient, type CommitAuthor, type GitClient } from "./git.js";
import {
  normalizeSessionLog,
  planConflictLadder,
  resolveUnionConflict,
} from "./ladder.js";
import type { LockOwner, LockRecord, SyncLock } from "./lock.js";
import { assertNoSecrets } from "./secrets.js";
import {
  createEngineStateTracker,
  type ConflictRef,
  type EngineState,
  type EngineStateTracker,
} from "./state.js";

/**
 * The sync engine (design §4.1) — ONE code path serving the CLI `sync`,
 * the MCP `sync` tool, the debounce, and the interval (invariant 4).
 *
 * `runCycle(trigger)`:
 *  1. acquire the sync lock (held ⇒ ownership report; two engines never race)
 *  2. pre-pull `format_version` guard on the REMOTE-tip rules (unsupported ⇒
 *     skip the pull entirely, enter rules-refused, report the actionable error)
 *  3. commit pending writes — one commit per write event, journal order:
 *     secrets lint first (blocked ⇒ report, keep pending, never push), then
 *     `git.commit` with the derived grammar and the HUMAN as author. Human
 *     working-tree changes go through the same derivation path.
 *  4. `pull --rebase --autostash`; conflicts ⇒ conflict ladder (§4.4). On
 *     success the pull's changed note paths go to the injected IndexPort —
 *     incremental re-parse, never a full re-walk (OD-5).
 *  5. post-sync rules hook when `.memory/rules.md` moved (pulled or locally
 *     edited): reload or refuse — refusal HALTS commits/push (placed before
 *     normalization/push so a refusal really stops everything downstream).
 *  6. union-log normalization (stable sort by timestamp, dedupe by entry id)
 *  7. regenerate `index/` maps — always a separate `chore(index)` commit
 *  8. push — never force (no force surface exists on the GitClient); network
 *     failures retry with capped exponential backoff via the injected
 *     TimerPort; local commits and the last-successful-sync timestamp stay
 *     intact on failure.
 *
 * Skip-clean: a cycle that finds a clean tree synced with the remote returns
 * to idle with zero commits — no empty commits, no cron noise (spec).
 *
 * Ports (OD-4/§1.3): lock, git, index, rules reload, clock, and timer are
 * all injected — task 3.13 wires the production implementations without
 * touching this module. The engine itself structurally satisfies the save
 * pipeline's `SyncPort` (`pullLatest` + `notifyWrite`), so wiring the real
 * pull-before-write is an assignment, not an adapter.
 */

export type SyncTrigger = "debounce" | "interval" | "manual" | "tool";

/** The index seam (OD-5): sync gains no runtime import edge on `src/index`. */
export interface IndexPort {
  /** Re-parse exactly these vault-relative paths (post-pull). */
  reparse(paths: string[]): Promise<unknown>;
  /** Regenerate `index/` maps; reports what changed on disk + the note count. */
  regenerateMaps(): Promise<{ changedPaths: string[]; noteCount: number }>;
}

export interface CycleBlocked {
  path: string;
  code: string;
  message: string;
}

export type CycleOutcome =
  | "synced"
  | "idle"
  | "locked"
  | "conflict"
  | "push-failed"
  | "rules-refused"
  | "secrets-blocked";

export interface CycleReport {
  trigger: SyncTrigger;
  outcome: CycleOutcome;
  pushed: boolean;
  /** Shas created this cycle, in commit order (note, ladder, regen). */
  commits: string[];
  blocked: CycleBlocked[];
  /** Open conflicts after the cycle (state snapshot). */
  conflicts: ConflictRef[];
  /** Present only when outcome === "locked" (M1: report, don't delegate). */
  lockHolder?: { pid: number; owner: string };
  error?: { code: string; message: string; hint?: string };
}

export interface SyncEngineDeps {
  vaultPath: string;
  /** Type-level only: backs the default state tracker (staleness). */
  store: IndexStore;
  rules: RulesModel;
  /** Static tunables or a provider (re-read per use; reload-aware). */
  tunables: SyncTunables | (() => SyncTunables);
  clock: Clock;
  /** Backoff sleeps (OD-4) — production timers .unref() (util/clock.ts). */
  timer: TimerPort;
  lock: SyncLock;
  git: GitClient;
  index: IndexPort;
  /** `loadRules` + `checkFormatVersion`; throws on refusal (design §3.1). */
  reloadRules(): Promise<RulesModel>;
  /** Re-resolve sync tunables for a reloaded model (design §3.1). */
  resolveTunables?(rules: RulesModel): SyncTunables;
  onRulesReloaded?(rules: RulesModel): void;
  /** The human identity — commit author, never the machine (design §4.3). */
  author?: CommitAuthor;
  /** Which actor this engine runs as (OD-4). Default "server". */
  owner?: LockOwner;
  /** Push attempts including the first; default 4 (3 backoff retries). */
  maxPushAttempts?: number;
  /** State tracker override (tests pre-seed lastSuccessfulSync). */
  state?: EngineStateTracker;
}

export interface SyncEngine {
  runCycle(trigger: SyncTrigger): Promise<CycleReport>;
  /** Journal a system write (the save pipeline's `SyncPort.notifyWrite`). */
  notifyWrite(event: WriteEvent): void;
  pendingWriteCount(): number;
  state(): EngineState;
  /** The save pipeline's `SyncPort.pullLatest`: guarded pull + ladder + reparse. */
  pullLatest(notePath?: string): Promise<void>;
}

const RULES_RELPATH = ".memory/rules.md";
const UPSTREAM_REF = "@{upstream}";
const PUSH_BACKOFF_BASE_MS = 1_000;
const PUSH_BACKOFF_CAP_MS = 30_000;
const DEFAULT_MAX_PUSH_ATTEMPTS = 4;
const MAX_LADDER_ROUNDS = 10;
const DEFAULT_CONFLICT_POLICY = "human_required";

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const tracker = deps.state ?? createEngineStateTracker({
    rules: deps.rules,
    store: deps.store,
    clock: deps.clock,
  });

  let rules = deps.rules;
  let tunablesOverride: SyncTunables | null = null;
  let journal: WriteEvent[] = [];
  let rulesRefused = false;
  // Cycles are serialized in-process: two timers firing together (or a tool
  // call racing the interval) queue instead of racing the clone's git state.
  let tail: Promise<unknown> = Promise.resolve();

  function tunables(): SyncTunables {
    if (tunablesOverride !== null) return tunablesOverride;
    return typeof deps.tunables === "function" ? deps.tunables() : deps.tunables;
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.then(task, task);
    tail = next.catch(() => undefined);
    return next;
  }

  function report(
    trigger: SyncTrigger,
    outcome: CycleOutcome,
    extra: Partial<CycleReport> = {},
  ): CycleReport {
    return {
      trigger,
      outcome,
      pushed: false,
      commits: [],
      blocked: [],
      conflicts: tracker.snapshot().conflicts,
      ...extra,
    };
  }

  /**
   * Reconciles the tracker's conflict list with the DURABLE record: the
   * conflict notes on disk (state.ts: "durable state = vault + git").
   * `supermemory resolve` flips a note to `status: resolved` on disk
   * only — the flip rides the next cycle (disclosed design order), and
   * this refresh is what makes that flip clear the engine's status and
   * resume pushing. Without it a resolved conflict would block pushes
   * forever.
   */
  async function refreshConflictsFromDisk(): Promise<void> {
    try {
      const records = await readConflictNotes(path.join(deps.vaultPath, "conflicts"));
      tracker.setConflicts(
        records
          .filter((record) => record.status === "open")
          .map((record) => ({
            noteId: record.noteId,
            notePath: record.notePath,
            snapshotBranch: record.snapshotBranch,
            conflictNotePath: record.path,
            detectedAt: record.detectedAt,
          })),
      );
    } catch {
      // An unreadable conflicts/ dir must never crash the cycle — the
      // pre-existing tracker state stands.
    }
  }

  function git(): GitClient {
    return deps.git;
  }

  function toAppError(err: unknown): AppError {
    if (err instanceof AppError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new AppError("SYNC_FAILED", message);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      deps.timer.set(ms, () => resolve());
    });
  }

  function backoffDelayMs(attempt: number): number {
    return Math.min(PUSH_BACKOFF_BASE_MS * 2 ** attempt, PUSH_BACKOFF_CAP_MS);
  }

  async function readVaultFile(relPath: string): Promise<string | undefined> {
    try {
      return await readFile(path.join(deps.vaultPath, relPath), "utf8");
    } catch {
      return undefined;
    }
  }

  async function headContent(relPath: string): Promise<string | undefined> {
    try {
      return await git().showFile("HEAD", relPath);
    } catch {
      return undefined;
    }
  }

  /** Hygiene: engine commits never sweep the pidfile or resolve sidecars. */
  function engineCommittable(relPath: string): boolean {
    const normalized = relPath.split("\\").join("/");
    if (normalized.startsWith(".memory/cache/")) return false;
    if (normalized.startsWith("conflicts/")) {
      if (normalized.endsWith(".local.md") || normalized.endsWith(".remote.md")) return false;
    }
    return true;
  }

  async function lintFile(relPath: string, content: string): Promise<AppError | undefined> {
    try {
      assertNoSecrets(relPath, content);
      return undefined;
    } catch (err) {
      return toAppError(err);
    }
  }

  function typeDefFor(relPath: string): { type: string; def: NoteTypeDef | undefined } {
    const resolved = resolveNoteType(relPath, rules);
    if (resolved) return { type: resolved.type, def: resolved.def };
    return { type: path.basename(relPath).replace(/\.md$/i, ""), def: undefined };
  }

  function noteIdFor(relPath: string, content: string): string {
    const { type, def } = typeDefFor(relPath);
    const { frontmatter } = parseNoteFile(content);
    return deriveNoteId(type, frontmatter, def) ?? path.basename(relPath).replace(/\.md$/i, "");
  }

  interface CommitOutcome {
    sha?: string;
    blocked?: CycleBlocked;
  }

  /** One commit for one write event (journal order, design §4.1 step 3). */
  async function commitWriteEvent(event: WriteEvent): Promise<CommitOutcome> {
    const relPath = event.path.split("\\").join("/");
    const onDisk = await readVaultFile(relPath);
    const inHead = await headContent(relPath);

    if (event.op === "delete" || onDisk === undefined) {
      if (inHead === undefined) return {}; // never committed, already gone — done
      const { type, def } = typeDefFor(relPath);
      const parsed = parseNoteFile(inHead);
      const message = deriveCommitMessage({
        op: "delete",
        type,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        fileName: path.basename(relPath),
        noteTypeDef: def,
        author: deps.author?.name,
      });
      await git().add([relPath]);
      const sha = await git().commit({
        message: formatCommitMessage(message),
        author: deps.author,
        paths: [relPath],
      });
      return { sha };
    }

    // add/update: lint the full content BEFORE anything is committed
    const lint = await lintFile(relPath, onDisk);
    if (lint) {
      return { blocked: { path: relPath, code: lint.code, message: lint.message } };
    }
    const { type, def } = typeDefFor(relPath);
    const parsed = parseNoteFile(onDisk);
    const prevParsed = inHead !== undefined ? parseNoteFile(inHead) : undefined;
    const op = inHead !== undefined ? "update" : "add";
    const message = deriveCommitMessage({
      op,
      type,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      fileName: path.basename(relPath),
      noteTypeDef: def,
      prevFrontmatter: prevParsed?.frontmatter,
      author: deps.author?.name,
      via: event.via,
    });
    await git().add([relPath]);
    const sha = await git().commit({
      message: formatCommitMessage(message),
      author: deps.author,
      paths: [relPath],
    });
    return { sha };
  }

  /** Human working-tree changes: the same derivation path, no Via trailer. */
  async function commitHumanChange(relPath: string): Promise<CommitOutcome> {
    const onDisk = await readVaultFile(relPath);
    const inHead = await headContent(relPath);

    if (onDisk === undefined) {
      if (inHead === undefined) return {};
      const { type, def } = typeDefFor(relPath);
      const parsed = parseNoteFile(inHead);
      const message = deriveCommitMessage({
        op: "delete",
        type,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        fileName: path.basename(relPath),
        noteTypeDef: def,
        author: deps.author?.name,
      });
      await git().add([relPath]);
      return { sha: await git().commit({ message: formatCommitMessage(message), author: deps.author, paths: [relPath] }) };
    }

    const lint = await lintFile(relPath, onDisk);
    if (lint) {
      return { blocked: { path: relPath, code: lint.code, message: lint.message } };
    }
    const { type, def } = typeDefFor(relPath);
    const parsed = parseNoteFile(onDisk);
    if (def) {
      const prevParsed = inHead !== undefined ? parseNoteFile(inHead) : undefined;
      const message = deriveCommitMessage({
        op: inHead !== undefined ? "update" : "add",
        type,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        fileName: path.basename(relPath),
        noteTypeDef: def,
        prevFrontmatter: prevParsed?.frontmatter,
        author: deps.author?.name,
      });
      await git().add([relPath]);
      return { sha: await git().commit({ message: formatCommitMessage(message), author: deps.author, paths: [relPath] }) };
    }
    // Not a declared note type (rules.md, config.yml, conflict notes…):
    // a deterministic chore, never free text (design §3 ownership table).
    const kind = inHead !== undefined ? "update" : "add";
    await git().add([relPath]);
    return { sha: await git().commit({ message: `chore(vault): ${kind} ${relPath}`, author: deps.author, paths: [relPath] }) };
  }

  async function commitPendingWrites(
    blocked: CycleBlocked[],
    commits: string[],
  ): Promise<boolean> {
    let rulesTouched = false;
    const pending = journal;
    journal = [];
    for (const event of pending) {
      const outcome = await commitWriteEvent(event);
      if (outcome.blocked) {
        blocked.push(outcome.blocked);
        journal.push(event); // keep pending — remediate, then it syncs
        continue;
      }
      if (outcome.sha) commits.push(outcome.sha);
      if (event.path.split("\\").join("/") === RULES_RELPATH) rulesTouched = true;
    }
    tracker.setPendingWrites(journal.length);

    const status = await git().status();
    // journal-handled paths (committed or blocked) are never re-attempted
    // through the human-change path — a blocked secret must not double-report
    const seen = new Set<string>();
    for (const event of pending) {
      seen.add(event.path.split("\\").join("/"));
    }
    const candidates = [...status.staged, ...status.changed, ...status.untracked]
      .map((p) => p.split("\\").join("/"))
      .filter((p) => {
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
      })
      .filter(engineCommittable)
      .sort((a, b) => a.localeCompare(b));
    for (const relPath of candidates) {
      const outcome = await commitHumanChange(relPath);
      if (outcome.blocked) blocked.push(outcome.blocked);
      if (outcome.sha) commits.push(outcome.sha);
      if (relPath === RULES_RELPATH) rulesTouched = true;
    }
    return rulesTouched;
  }

  /** Pre-pull `format_version` guard on the REMOTE tip (design §3.1). */
  async function prePullGuard(): Promise<AppError | undefined> {
    let raw: string;
    try {
      raw = await git().showFile(UPSTREAM_REF, RULES_RELPATH);
    } catch {
      return undefined; // no upstream / no remote rules yet — nothing to check
    }
    const { frontmatter } = parseNoteFile(raw);
    try {
      checkFormatVersion(
        typeof frontmatter["format_version"] === "string" ||
          typeof frontmatter["format_version"] === "number"
          ? (frontmatter["format_version"] as string | number)
          : undefined,
      );
      return undefined;
    } catch (err) {
      return toAppError(err);
    }
  }

  /** The ladder's curated path (design §4.4): abort, snapshot, note, pause. */
  async function curatedAbort(curatedPaths: string[], commits: string[]): Promise<void> {
    await git().rebaseAbort();
    const detectedAt = deps.clock.now();
    const conflictsDir = path.join(deps.vaultPath, "conflicts");
    const fresh: ConflictRef[] = [];
    for (const relPath of curatedPaths) {
      const localText = (await readVaultFile(relPath)) ?? "";
      const noteId = noteIdFor(relPath, localText);
      const snapshotBranch = conflictSnapshotBranchName(detectedAt, noteId);
      await git().createBranch(snapshotBranch, UPSTREAM_REF);
      const remoteText = await git()
        .showFile(snapshotBranch, relPath)
        .catch(() => "");
      const noteAbs = await writeConflictNote(conflictsDir, {
        noteId,
        notePath: relPath,
        snapshotBranch,
        detectedAt,
        localSummary: summarizeSide(localText),
        remoteSummary: summarizeSide(remoteText),
      });
      const noteRel = path.relative(deps.vaultPath, noteAbs).split("\\").join("/");
      await git().add([noteRel]);
      commits.push(
        await git().commit({
          message: conflictNoteCommitHeader(noteId),
          author: deps.author,
          paths: [noteRel],
        }),
      );
      fresh.push({
        noteId,
        notePath: relPath,
        snapshotBranch,
        conflictNotePath: noteAbs,
        detectedAt: detectedAt.toISOString(),
      });
    }
    const existing = tracker
      .snapshot()
      .conflicts.filter((prev) => !fresh.some((f) => f.conflictNotePath === prev.conflictNotePath));
    tracker.setConflicts([...existing, ...fresh]);
    tracker.setPushPaused(true);
  }

  /**
   * Runs the conflict ladder to settlement. Returns "curated" when the
   * rebase was aborted for a curated conflict, "auto" when every conflict
   * was machine-resolvable (possibly over several continue rounds).
   * Auto-resolved rounds record the rebase's own continue commit (git makes
   * it, not `git.commit` — captured by ref compare, empty patches skipped).
   */
  async function conflictLadder(commits: string[]): Promise<"auto" | "curated"> {
    for (let round = 0; round < MAX_LADDER_ROUNDS; round++) {
      const status = await git().status();
      if (status.conflicted.length === 0) return "auto";
      const decision = planConflictLadder(status.conflicted, rules);
      if (decision.action === "curated-abort") {
        await curatedAbort(decision.curatedPaths, commits);
        return "curated";
      }
      const handled = [...decision.byCategory.generated];
      await git().checkoutTheirs(handled);
      for (const relPath of decision.byCategory.union) {
        const abs = path.join(deps.vaultPath, relPath);
        const content = await readFile(abs, "utf8");
        await writeFile(abs, resolveUnionConflict(content), "utf8");
        handled.push(relPath);
      }
      await git().add(handled);
      const before = await git().revParse("HEAD");
      await git().rebaseContinue();
      const after = await git().revParse("HEAD").catch(() => before);
      if (after !== before) commits.push(after);
    }
    await git().rebaseAbort();
    throw new AppError(
      "CONFLICT_CURATED",
      `the rebase did not settle after ${MAX_LADDER_ROUNDS} ladder rounds — it was aborted and local state is intact`,
      { hint: "Resolve with plain git, or run supermemory resolve once a conflict note exists." },
    );
  }

  /** Pull + ladder + incremental reparse of the pulled diff (OD-5). */
  async function pullWithLadder(
    commits: string[],
  ): Promise<{ curated: boolean; moved: boolean; rulesTouched: boolean }> {
    let preHead: string | undefined;
    try {
      preHead = await git().revParse("HEAD");
    } catch {
      preHead = undefined;
    }
    try {
      await git().pullRebaseAutostash();
    } catch (pullError) {
      const ladder = await conflictLadder(commits);
      if (ladder === "curated") return { curated: true, moved: false, rulesTouched: false };
      // A pull that fails WITHOUT conflicts (network) simply didn't move
      // HEAD; the push below will surface the failure with backoff.
      if (pullError instanceof Error && preHead !== undefined) {
        const post = await git().revParse("HEAD").catch(() => preHead);
        if (post !== preHead) return { curated: false, moved: true, rulesTouched: false };
      }
    }
    const postHead = await git().revParse("HEAD").catch(() => preHead);
    let changedPaths: string[] = [];
    if (preHead !== undefined && postHead !== undefined && postHead !== preHead) {
      changedPaths = await git().diffNames(preHead, postHead);
      await deps.index.reparse(changedPaths);
    }
    const moved = postHead !== preHead;
    return { curated: false, moved, rulesTouched: changedPaths.includes(RULES_RELPATH) };
  }

  /** Post-sync rules hook (design §3.1): reload or refuse. */
  async function reloadRulesHook(): Promise<AppError | undefined> {
    try {
      const next = await deps.reloadRules();
      rules = next;
      if (deps.resolveTunables) tunablesOverride = deps.resolveTunables(next);
      tracker.setRules(next);
      deps.onRulesReloaded?.(next);
      return undefined;
    } catch (err) {
      return toAppError(err);
    }
  }

  /** Union-policy logs: normalize in place; returns the changed paths. */
  async function normalizeUnionLogs(): Promise<string[]> {
    const changed: string[] = [];
    for (const [type, def] of Object.entries(rules.noteTypes)) {
      const policy =
        def.conflictPolicy ?? rules.conflictPolicyDefaults[type] ?? DEFAULT_CONFLICT_POLICY;
      if (policy !== "union") continue;
      for (const relPath of await walkMarkdown(path.join(deps.vaultPath, def.folder), def.folder)) {
        const content = (await readVaultFile(relPath)) ?? "";
        const normalized = normalizeSessionLog(content);
        if (normalized !== content) {
          await writeFile(path.join(deps.vaultPath, relPath), normalized, "utf8");
          changed.push(relPath);
        }
      }
    }
    return changed;
  }

  /** Lints every file, commits them together under one chore message. */
  async function lintAndCommitAll(paths: string[], message: string): Promise<string | undefined> {
    for (const relPath of paths) {
      const content = (await readVaultFile(relPath)) ?? "";
      const lint = await lintFile(relPath, content);
      if (lint) return undefined; // defense in depth: never commit a secret
    }
    await git().add(paths);
    return git().commit({ message, author: deps.author });
  }

  async function pushWithBackoff(): Promise<{ pushed: boolean }> {
    const attempts = deps.maxPushAttempts ?? DEFAULT_MAX_PUSH_ATTEMPTS;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await git().push();
        return { pushed: true };
      } catch {
        if (attempt === attempts - 1) return { pushed: false };
        await sleep(backoffDelayMs(attempt));
      }
    }
    return { pushed: false };
  }

  async function localAheadOfRemote(): Promise<boolean> {
    try {
      const head = await git().revParse("HEAD");
      const upstream = await git().revParse(UPSTREAM_REF);
      return head !== upstream;
    } catch {
      return true; // can't prove sync — don't skip the cycle
    }
  }

  async function lockedCycle(trigger: SyncTrigger): Promise<CycleReport> {
    const blocked: CycleBlocked[] = [];
    const commits: string[] = [];

    // Durable conflict record first: a conflict resolved on disk since
    // the last cycle clears status (and un-pauses push) right here.
    await refreshConflictsFromDisk();

    // 2. pre-pull format_version guard — refuse BEFORE anything moves
    const guard = await prePullGuard();
    if (guard) {
      rulesRefused = true;
      tracker.setPushPaused(true);
      return report(trigger, "rules-refused", { error: toErrorShape(guard) });
    }
    rulesRefused = false;

    // 3. commit pending writes (journal order) + human working-tree changes
    let rulesTouched = await commitPendingWrites(blocked, commits);

    // 4. pull --rebase --autostash (+ ladder on conflicts, reparse on success)
    const pulled = await pullWithLadder(commits);
    if (pulled.curated) {
      return report(trigger, "conflict", { commits, blocked });
    }
    rulesTouched = rulesTouched || pulled.rulesTouched;

    // 5. post-sync rules hook — refusal halts commits/push (§3.1)
    if (rulesTouched) {
      const hookError = await reloadRulesHook();
      if (hookError) {
        tracker.setPushPaused(true);
        return report(trigger, "rules-refused", { commits, blocked, error: toErrorShape(hookError) });
      }
    }

    // 6. union-log normalization (post-rebase canonicalization)
    const normalized = await normalizeUnionLogs();
    if (normalized.length > 0) {
      const sha = await lintAndCommitAll(normalized, "chore(sync): normalize session logs");
      if (sha) commits.push(sha);
    }

    // 7. regenerate index maps — always a separate chore(index) commit
    const regen = await deps.index.regenerateMaps();
    if (regen.changedPaths.length > 0) {
      const sha = await lintAndCommitAll(
        regen.changedPaths,
        `chore(index): regenerate maps (${regen.noteCount} notes)`,
      );
      if (sha) commits.push(sha);
    }

    // skip-clean: nothing happened anywhere and we are synced — idle, zero
    // commits (design §4.1). Deliberately AFTER normalization/regen: a rebase
    // that drops an emptied patch can still leave a non-canonical union log
    // behind, and canonicalization is real work, not cron noise. A pull that
    // integrated remote changes is also real work — never reported as idle.
    const status = await git().status();
    if (
      commits.length === 0 &&
      blocked.length === 0 &&
      !pulled.moved &&
      !(await localAheadOfRemote()) &&
      status.clean
    ) {
      return report(trigger, "idle");
    }

    // unresolved conflicts pause ONLY pushing — local work continues
    if (tracker.snapshot().conflicts.length > 0) {
      return report(trigger, "conflict", { commits, blocked });
    }

    // 8. push — never force; capped exponential backoff on network failure
    const push = await pushWithBackoff();
    if (push.pushed) {
      tracker.setLastSuccessfulSync(deps.clock.now());
      tracker.setPushPaused(false);
    }
    const outcome: CycleOutcome = push.pushed
      ? blocked.length > 0
        ? "secrets-blocked"
        : "synced"
      : "push-failed";
    return report(trigger, outcome, { pushed: push.pushed, commits, blocked });
  }

  function runCycle(trigger: SyncTrigger): Promise<CycleReport> {
    return enqueue(async (): Promise<CycleReport> => {
      // 1. lock — two engines never race on the same clone (OD-4)
      const handle = await deps.lock.acquire(deps.owner ?? "server");
      if (handle === null) {
        const holder: LockRecord | null = await deps.lock.currentHolder?.().catch(() => null) ?? null;
        return report(trigger, "locked", {
          lockHolder: holder ? { pid: holder.pid, owner: holder.owner } : undefined,
        });
      }
      try {
        return await lockedCycle(trigger);
      } catch (err) {
        if (err instanceof AppError && err.code === "CONFLICT_CURATED") {
          return report(trigger, "conflict", { error: toErrorShape(err) });
        }
        throw err;
      } finally {
        await handle.release();
      }
    });
  }

  return {
    runCycle,
    notifyWrite(event: WriteEvent): void {
      journal.push(event);
      tracker.setPendingWrites(journal.length);
    },
    pendingWriteCount(): number {
      return journal.length;
    },
    state(): EngineState {
      return tracker.snapshot();
    },
    pullLatest(_notePath?: string): Promise<void> {
      return enqueue(async () => {
        const handle = await deps.lock.acquire(deps.owner ?? "server");
        if (handle === null) {
          throw new AppError("LOCK_HELD", "sync is owned by another actor — try again shortly", {
            hint: "The owning server runs sync automatically; use its `sync` tool instead.",
          });
        }
        try {
          await refreshConflictsFromDisk();
          const guard = await prePullGuard();
          if (guard) throw guard;
          const commits: string[] = [];
          const pulled = await pullWithLadder(commits);
          if (pulled.curated) {
            throw new AppError(
              "CONFLICT_CURATED",
              "the pull hit a curated conflict — the rebase was aborted and local state is intact",
              { hint: "Run `supermemory resolve` to merge both sides, then sync." },
            );
          }
        } finally {
          await handle.release();
        }
      });
    },
  };
}

function toErrorShape(err: AppError): CycleReport["error"] {
  return { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) };
}

/** Deterministic one-line summary for conflict notes' side sections. */
function summarizeSide(text: string): string {
  const lines = text.split("\n");
  const heading = lines.find((line) => /^#\s+/.test(line));
  return `${heading?.trim() ?? "(no heading)"} — ${lines.length} lines`;
}

/** Recursive `.md` walk under absDir, returned as vault-relative paths. */
async function walkMarkdown(absDir: string, relPrefix: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return []; // folder not created yet — nothing to normalize
  }
  const found: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${relPrefix.replace(/\/$/, "")}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await walkMarkdown(path.join(absDir, entry.name), rel)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(rel);
    }
  }
  return found;
}

// re-exported for the composition root (task 3.13) — one git surface
export { createGitClient };
export type { CommitAuthor, GitClient };
