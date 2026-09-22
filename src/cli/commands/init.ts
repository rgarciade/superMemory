import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { simpleGit, type SimpleGit } from "simple-git";
import { AppError } from "../../util/errors.js";
import { createLogger } from "../../util/log.js";
import { assertVaultOutsideAppRepo, validateBoot } from "../../boot/validate-boot.js";

/**
 * `supermemory init [path]` — one-time vault scaffold (RFC §7.1):
 * `.memory/` (rules.md v1 defaults incl. the git tunable seed, templates/,
 * config.yml), default folders incl. the Obsidian-visible top-level
 * `conflicts/`, a vault `.gitignore` for the derived cache, and
 * `.gitattributes` (union logs / ours index). Then boot-validates and
 * makes the initial commit. The scaffold bytes match the committed test
 * fixture (pinned by test) so init'd vaults and test vaults agree.
 */

const RULES_MD = `---
format_version: 1.0
---

# Team Memory Rules

Prose explanation the team can read and discuss. Everything the engine
needs is in the blocks below.

## Note types

\`\`\`yaml
note_types:
  spec:
    folder: specs/
    frontmatter:            # required fields and types
      spec_id: { type: string, required: true, pattern: "SPEC-[a-z0-9-]+" }
      status: { type: enum, values: [draft, active, deprecated], required: true }
      owner: { type: string, required: true }
      review_after: { type: date, required: false }
    naming: "{spec_id}-{slug}.md"
    sections: [Purpose, Scope, Decisions, "## Linked Knowledge"]
    conflict_policy: human_required

  decision:
    folder: decisions/
    frontmatter:
      decision_id: { type: string, required: true, pattern: "DEC-[0-9]+" }
      spec_id: { type: string, required: true }     # the hub it belongs to
      status: { type: enum, values: [proposed, accepted, superseded] }
    naming: "{decision_id}-{slug}.md"
    conflict_policy: human_required

  incident:
    folder: incidents/
    frontmatter:
      incident_id: { type: string, required: true, pattern: "INC-[0-9]+" }
      spec_id: { type: string, required: false }
      status: { type: enum, values: [open, resolved] }
    conflict_policy: human_required

  session_log:              # append-only
    folder: logs/
    frontmatter:
      date: { type: date, required: true }
      actor: { type: string, required: true }
    conflict_policy: union
\`\`\`

## Lifecycle

\`\`\`yaml
lifecycle:
  staleness:
    field: review_after
    on_stale: flag          # surfaced by the \`find\` tool and status reports
  archive:
    folder: attic/
    policy: manual          # or \`auto\` per type
\`\`\`

## Conflict policies

\`\`\`yaml
conflict_policy_defaults:
  generated_indexes: regenerate
  session_logs: union
  decisions: human_required
  specs: human_required
  daily_notes: theirs_and_archive   # remote wins; local side archived in attic/
\`\`\`

## Git

\`\`\`yaml
git:
  mode: auto              # auto | manual | pr  (team policy; see §6.1)
  sync_interval_minutes: 15
  debounce_seconds: 45
  commit_language: en
  secrets_lint: true
  generated_paths: [index/, .memory/cache/]
\`\`\`
`;

const CONFIG_YML = `# Team sync policy (committed; travels with the vault — RFC §8).
# Precedence: SUPERMEMORY_* env > this file > .memory/rules.md git: block
# > built-ins (15 min / 45 s). Timing knobs only — hygiene gates are not
# overridable here.
sync:
  # sync_interval_minutes: 15
  # debounce_seconds: 45
`;

const GITATTRIBUTES = `# append-only: both sides concatenated
logs/**     merge=union
# generated: regenerating after merge is fine
index/**    merge=ours
`;

const VAULT_GITIGNORE = `.memory/cache/
.memory/local.json
`;

const TEMPLATES: Record<string, string> = {
  "decision.md": `---
decision_id: DEC-{{next_id}}
spec_id: {{spec_id}}
status: proposed
date: {{today}}
author: {{author}}
---

# {{title}}

## Context
Why this decision came up.

## Decision
What we decided.

## Consequences
What this implies for the codebase / other specs.
`,
  "spec.md": `---
spec_id: {{spec_id}}
status: draft
owner: {{author}}
review_after: {{today}}
---

# {{title}}

## Purpose
What this spec covers and why it exists.

## Scope
What is in and out of scope.

## Decisions
The decisions this spec records.

## Linked Knowledge

Auto-maintained index of decisions, incidents, and learnings that reference
this spec (by spec_id). The \`save\` tool appends entries here when they are
created with this spec_id.
`,
  "incident.md": `---
incident_id: INC-{{next_id}}
spec_id: {{spec_id}}
status: open
date: {{today}}
author: {{author}}
---

# {{title}}

## Summary
What happened.

## Impact
Who or what was affected.

## Resolution
How it was resolved (updated as work progresses).
`,
  "session-log.md": `---
date: {{today}}
actor: {{author}}
---

# Session {{today}}

## Notes

- {{content}}
`,
  "agent-instructions.md": `# Agent Instructions

Consult specs before changing code that a spec covers. Record durable
decisions as \`decision\` notes linked to their spec via \`spec_id\`. Log
sessions in the day's session log.

- Before implementing, \`find\` the relevant spec and read it with
  \`read_with_context\`.
- After a meaningful decision, \`save\` a decision note linked to the spec.
- Never edit \`index/\` by hand — it is regenerated.
- Secrets never enter the vault; the sync engine blocks flagged secrets.
`,
};

const DEFAULT_FOLDERS = [
  "specs",
  "decisions",
  "incidents",
  "learnings",
  "facts",
  "logs",
  "index",
  "conflicts",
];

export const INIT_COMMIT_MESSAGE = "chore(supermemory): initialize vault";

export interface InitResult {
  committed: boolean;
  root: string;
}

export async function initVault(vaultPath: string): Promise<InitResult> {
  // (1) the target must be an existing directory
  if (!existsSync(vaultPath)) {
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      `vault path "${vaultPath}" does not exist.`,
      { hint: "Create (or clone) the vault directory first: mkdir + git init, or git clone <vault-url>." },
    );
  }

  // (2) it must already be a git repository
  if (!existsSync(path.join(vaultPath, ".git"))) {
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      `vault "${vaultPath}" is not a git repository yet.`,
      { hint: "Run `git init` inside the vault (or clone the team vault), then re-run supermemory init." },
    );
  }

  // (3) refuse to clobber an initialized vault
  const rulesPath = path.join(vaultPath, ".memory", "rules.md");
  if (existsSync(rulesPath)) {
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      `vault "${vaultPath}" already has ${rulesPath} — refusing to re-initialize.`,
      { hint: "To adopt new defaults, edit .memory/rules.md by hand; init never overwrites." },
    );
  }

  // (4) must not be (or be inside) the supermemory source repo — every
  // guard runs BEFORE any write, so a failure here leaves the target
  // untouched instead of scaffolding into the app repo first and
  // discovering the problem only at the post-write validateBoot call.
  assertVaultOutsideAppRepo(vaultPath);

  // (5) none of the scaffold paths (or their parent directories) may
  // be a symlink — `existsSync`/`writeFile`/`mkdir` all follow
  // symlinks, so a dangling `.memory/config.yml` symlink would make
  // init write the config OUTSIDE the vault (through the link) instead
  // of refusing, and a symlinked `.gitignore` would make a successful
  // run append to and commit whatever the link points at outside the
  // vault. Checked with `lstat` (never follows symlinks), before any
  // write.
  await assertNoScaffoldSymlinks(vaultPath);

  // From here on, every write is tracked so a failure can roll back
  // EXACTLY what this run did — nothing pre-existing, ever (a vault's
  // `.memory/` may already hold unrelated content even without
  // rules.md; the write-if-absent guarantee above must hold even when
  // the run fails partway through).
  const tracker = newScaffoldTracker();
  try {
    const memoryDir = path.join(vaultPath, ".memory");
    const templatesDir = path.join(memoryDir, "templates");
    await ensureDir(templatesDir, tracker);

    const writtenPaths: string[] = [rulesPath];
    await createFile(rulesPath, RULES_MD, tracker);

    const configPath = path.join(memoryDir, "config.yml");
    await writeIfAbsent(configPath, CONFIG_YML, tracker);
    writtenPaths.push(configPath);

    for (const [name, content] of Object.entries(TEMPLATES)) {
      const templatePath = path.join(templatesDir, name);
      await writeIfAbsent(templatePath, content, tracker);
      writtenPaths.push(templatePath);
    }

    // default folders (conflicts/ top-level: visible in Obsidian)
    for (const folder of DEFAULT_FOLDERS) {
      const folderPath = path.join(vaultPath, folder);
      await ensureDir(folderPath, tracker);
      const gitkeepPath = path.join(folderPath, ".gitkeep");
      await writeIfAbsent(gitkeepPath, "", tracker);
      writtenPaths.push(gitkeepPath);
    }

    // vault-level git files — merge missing lines into any pre-existing
    // file instead of overwriting it (a vault root may already have its
    // own .gitignore/.gitattributes for unrelated reasons); the
    // original bytes are captured so a rollback can restore them.
    const gitignorePath = path.join(vaultPath, ".gitignore");
    await mergeMissingLines(gitignorePath, VAULT_GITIGNORE, tracker);
    writtenPaths.push(gitignorePath);

    const gitattributesPath = path.join(vaultPath, ".gitattributes");
    await mergeMissingLines(gitattributesPath, GITATTRIBUTES, tracker);
    writtenPaths.push(gitattributesPath);

    // validate the fresh vault (five checks), then make the initial
    // commit — staging ONLY the scaffold paths we just wrote, never
    // `git add .` (which would also stage anything else sitting
    // untracked in the vault, previously-ignored files included).
    await validateBoot(vaultPath);
    const git = simpleGit(vaultPath);
    const relativePaths = [
      ...new Set(writtenPaths.map((p) => path.relative(vaultPath, p))),
    ];
    tracker.stagedRelativePaths = relativePaths;
    tracker.preStageIndexEntries = await snapshotIndexEntries(git, relativePaths);
    await commitInitScaffold(git, relativePaths, INIT_COMMIT_MESSAGE);
  } catch (err) {
    await rollbackScaffold(vaultPath, tracker);
    if (err instanceof AppError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      `initializing the vault at "${vaultPath}" failed: ${reason}`,
      {
        hint: "Everything this run created was removed and anything it staged was unstaged (pre-existing content was never touched) — fix the underlying issue (e.g. git identity: git config user.name / user.email, a rejecting commit hook, or a file permission) and re-run `supermemory init`.",
        cause: err,
      },
    );
  }

  return { committed: true, root: vaultPath };
}

/**
 * Records exactly what one `initVault` run creates or changes, so a
 * failure can roll back precisely that — never anything that
 * pre-existed. Tracked, not swept: `rm(".memory", {recursive:true})`
 * (the previous approach) would delete any unrelated content a vault's
 * `.memory/` already held (notes, a hand-written config.yml, ...).
 */
interface ScaffoldTracker {
  /** Absolute paths of directories this run created. */
  createdDirs: string[];
  /** Absolute paths of files this run created from scratch. */
  createdFiles: string[];
  /**
   * Absolute paths of files this run wrote via merge, with the original
   * RAW BYTES captured before the write (never decoded as text, so a
   * non-UTF8 byte is never corrupted) — `undefined` means the file did
   * not exist and was created fresh (rollback deletes it); a `Buffer`
   * means it existed and is restored verbatim (rollback never merges
   * again — it puts back exactly the original bytes).
   */
  mergedFiles: Array<{ path: string; original: Buffer | undefined }>;
  /** Relative paths (from the vault root) this run staged with `git add`. */
  stagedRelativePaths: string[];
  /**
   * Each staged path's index entry from BEFORE `git add` ran —
   * `undefined` means the path had no index entry (untracked/unstaged)
   * beforehand. Captured via `git ls-files -s`, so rollback can restore
   * the index EXACTLY, not merely `git reset -- <paths>` to HEAD: if
   * the user had already staged a version of e.g. `.gitignore` that
   * differs from BOTH HEAD and whatever init merged, resetting to HEAD
   * (or, on an unborn branch with no HEAD to reset to, dropping the
   * entry entirely) silently loses it.
   */
  preStageIndexEntries: Map<string, IndexEntry>;
}

interface IndexEntry {
  mode: string;
  sha: string;
}

function newScaffoldTracker(): ScaffoldTracker {
  return {
    createdDirs: [],
    createdFiles: [],
    mergedFiles: [],
    stagedRelativePaths: [],
    preStageIndexEntries: new Map(),
  };
}

/**
 * Refuses (before any write) if any scaffold path — or a default
 * folder that will hold one — already exists as a symlink. `lstat`
 * never follows symlinks (unlike `existsSync`/`stat`), so this is the
 * only reliable way to detect one; a path that does not exist yet is
 * not a problem (`lstat` throws ENOENT, treated as "nothing to guard").
 */
async function assertNoScaffoldSymlinks(vaultPath: string): Promise<void> {
  const memoryDir = path.join(vaultPath, ".memory");
  const templatesDir = path.join(memoryDir, "templates");
  const candidates = new Set<string>([
    vaultPath,
    memoryDir,
    templatesDir,
    path.join(memoryDir, "rules.md"),
    path.join(memoryDir, "config.yml"),
    path.join(vaultPath, ".gitignore"),
    path.join(vaultPath, ".gitattributes"),
  ]);
  for (const name of Object.keys(TEMPLATES)) {
    candidates.add(path.join(templatesDir, name));
  }
  for (const folder of DEFAULT_FOLDERS) {
    const folderPath = path.join(vaultPath, folder);
    candidates.add(folderPath);
    candidates.add(path.join(folderPath, ".gitkeep"));
  }

  for (const candidate of candidates) {
    let stats;
    try {
      stats = await lstat(candidate);
    } catch {
      continue; // doesn't exist yet — nothing to guard against
    }
    if (stats.isSymbolicLink()) {
      throw new AppError(
        "BOOT_VALIDATION_FAILED",
        `vault scaffold path "${candidate}" is a symlink.`,
        {
          hint: "Refusing to follow a symlink into or out of the vault — remove it (or replace it with a real file/directory) and re-run `supermemory init`.",
        },
      );
    }
  }
}

/**
 * Ensures `dirPath` (and any missing parents) exist, recording only the
 * directories this call actually created — a pre-existing ancestor is
 * never recorded, so rollback can never remove it.
 */
async function ensureDir(dirPath: string, tracker: ScaffoldTracker): Promise<void> {
  const missing: string[] = [];
  let current = dirPath;
  while (!existsSync(current)) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (missing.length > 0) {
    // Register BEFORE creating: `mkdir(..., {recursive:true})` can
    // create some of `missing` and then fail partway (e.g. ENOSPC) —
    // if the push happened after, rollback would never learn about
    // whatever was actually created on disk.
    tracker.createdDirs.push(...missing);
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Creates `filePath` fresh — exclusive create (`wx`: fails instead of
 * overwriting if the path already exists, closing the TOCTOU race
 * between an `existsSync` check and the write). Registers the path in
 * the tracker BEFORE writing: a write that fails partway through (e.g.
 * EFBIG under a file-size rlimit, ENOSPC, a quota) still leaves
 * SOMETHING on disk at `filePath` (a truncated file), and the tracker
 * must know about it regardless of how far the write got, or rollback
 * leaves a truncated scaffold file behind that then blocks every
 * re-run ("already has rules.md").
 */
async function createFile(
  filePath: string,
  content: string,
  tracker: ScaffoldTracker,
): Promise<void> {
  tracker.createdFiles.push(filePath);
  await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
}

/**
 * Writes `content` to `filePath` only if it does not already exist —
 * checked AND enforced atomically via the `wx` flag (see `createFile`),
 * not just an `existsSync` check followed by a separate write.
 */
async function writeIfAbsent(
  filePath: string,
  content: string,
  tracker: ScaffoldTracker,
): Promise<void> {
  if (existsSync(filePath)) return;
  tracker.createdFiles.push(filePath);
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if (isEexist(err)) {
      // Lost the race: something else created this exact path between
      // our existsSync check and the write. Treat it exactly like
      // "already existed" — untrack it, touch nothing.
      tracker.createdFiles.pop();
      return;
    }
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

/**
 * Writes `content` to `filePath` if it does not exist; otherwise
 * appends only the lines from `content` that are not already
 * effectively present, so a pre-existing file (e.g. a vault root's own
 * `.gitignore`) never loses its own entries. The original bytes are
 * captured into `tracker` before any write, so a rollback can restore
 * them exactly (never re-running the merge).
 *
 * Operates on raw bytes (`Buffer`), never decodes the existing file as
 * UTF-8 text: a byte that is not valid UTF-8 on its own (e.g. a Latin-1
 * 0xE9) would otherwise be silently and irreversibly turned into the
 * UTF-8 replacement character on read, corrupting it in both the
 * merged output that gets committed and whatever a rollback "restores".
 * `content` (our own scaffold template) is always plain ASCII, so
 * comparing/appending it as bytes is exact either way.
 *
 * "Effectively present" is negation-aware (gitignore semantics: a later
 * `!line` un-ignores an earlier `line`) — only the LAST occurrence among
 * a line and its negation decides whether it is still in effect, so a
 * negated entry is treated as missing and re-appended. The file's own
 * existing line ending (LF or CRLF) is preserved for the appended lines.
 */
async function mergeMissingLines(
  filePath: string,
  content: string,
  tracker: ScaffoldTracker,
): Promise<void> {
  const existed = existsSync(filePath);
  const original = existed ? await readFile(filePath) : undefined;
  tracker.mergedFiles.push({ path: filePath, original });

  if (original === undefined) {
    await writeFile(filePath, content, "utf8");
    return;
  }

  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const eolBuf = Buffer.from(eol, "ascii");
  const existingLines = splitLinesRaw(original);
  const requiredLines = content
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trim())
    .filter((line) => line.length > 0);

  const missingLines = requiredLines.filter(
    (line) => !isEffectivelyPresentRaw(existingLines, line),
  );
  if (missingLines.length === 0) return;

  const needsSeparator = original.length > 0 && !bufferEndsWith(original, eolBuf);
  const appended = Buffer.from(missingLines.join(eol) + eol, "utf8");
  await writeFile(
    filePath,
    needsSeparator ? Buffer.concat([original, eolBuf, appended]) : Buffer.concat([original, appended]),
  );
}

/** Splits `buf` on raw `\n` bytes, trimming a trailing `\r` and ASCII space/tab from each line — never decodes the bytes as text. */
function splitLinesRaw(buf: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x0a) {
      lines.push(trimLineRaw(buf.subarray(start, i)));
      start = i + 1;
    }
  }
  if (start < buf.length) lines.push(trimLineRaw(buf.subarray(start)));
  return lines;
}

function trimLineRaw(line: Buffer): Buffer {
  let end = line.length;
  if (end > 0 && line[end - 1] === 0x0d) end -= 1; // trailing CR (CRLF line)
  let start = 0;
  while (start < end && isAsciiBlank(line[start]!)) start += 1;
  while (end > start && isAsciiBlank(line[end - 1]!)) end -= 1;
  return line.subarray(start, end);
}

function isAsciiBlank(byte: number): boolean {
  return byte === 0x20 || byte === 0x09;
}

function bufferEndsWith(buf: Buffer, suffix: Buffer): boolean {
  if (suffix.length === 0) return true;
  if (buf.length < suffix.length) return false;
  return buf.subarray(buf.length - suffix.length).equals(suffix);
}

/**
 * True when `target` (one of our own plain-ASCII scaffold lines) is in
 * effect among `existingLines` (raw byte lines from the file): its LAST
 * occurrence (among itself and its `!target` negation) must be the
 * positive form. Absent entirely, or last-negated, counts as NOT
 * present (so it gets re-appended).
 */
function isEffectivelyPresentRaw(existingLines: Buffer[], target: string): boolean {
  const targetBuf = Buffer.from(target, "utf8");
  const negatedBuf = Buffer.from(`!${target}`, "utf8");
  let present = false;
  for (const line of existingLines) {
    if (line.equals(targetBuf)) present = true;
    else if (line.equals(negatedBuf)) present = false;
  }
  return present;
}

/**
 * Snapshots the current index entry (mode + blob sha) for each of
 * `relativePaths`, BEFORE staging — a path absent from the result had
 * no index entry at all. `git ls-files -s` reads purely from the
 * index, so this works identically with or without a HEAD commit.
 */
async function snapshotIndexEntries(
  git: SimpleGit,
  relativePaths: string[],
): Promise<Map<string, IndexEntry>> {
  const snapshot = new Map<string, IndexEntry>();
  if (relativePaths.length === 0) return snapshot;
  const raw = await git.raw(["ls-files", "-s", "--", ...relativePaths]);
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const tabIndex = line.indexOf("\t");
    if (tabIndex === -1) continue;
    const relPath = line.slice(tabIndex + 1);
    const [mode, sha] = line.slice(0, tabIndex).trim().split(/\s+/);
    if (mode && sha) snapshot.set(relPath, { mode, sha });
  }
  return snapshot;
}

/**
 * Restores the index to exactly its pre-stage state for
 * `relativePaths`: a path that had an entry gets that exact entry back
 * (`update-index --cacheinfo`, no stdin needed, and untouched by
 * whether a HEAD exists); a path that had none is force-removed from
 * the index (`update-index --force-remove`, a safe no-op if it's
 * already absent). Never touches the working tree.
 */
async function restoreIndexEntries(
  git: SimpleGit,
  relativePaths: string[],
  snapshot: Map<string, IndexEntry>,
): Promise<void> {
  for (const relPath of relativePaths) {
    const entry = snapshot.get(relPath);
    try {
      if (entry) {
        await git.raw([
          "update-index",
          "--cacheinfo",
          `${entry.mode},${entry.sha},${relPath}`,
        ]);
      } else {
        await git.raw(["update-index", "--force-remove", "--", relPath]);
      }
    } catch {
      // best-effort
    }
  }
}

/**
 * Stages exactly `relativePaths` (never `git add .`) and commits ONLY
 * those paths (never a bare `git commit` with no pathspec) — if the
 * user already had unrelated changes staged before running init (e.g.
 * `git add .env`), a pathspec-less commit would sweep those into the
 * init commit too. `git commit -- <pathspec>` restricts the commit to
 * exactly the given paths regardless of anything else in the index,
 * leaving the user's own staged changes staged (neither committed nor
 * discarded). Throws when git resolves the commit without an actual
 * commit hash — simple-git resolves normally (no throw) when there is
 * nothing to commit, which would otherwise be silently reported as
 * success.
 */
export async function commitInitScaffold(
  git: SimpleGit,
  relativePaths: string[],
  message: string,
): Promise<void> {
  await git.add(relativePaths);
  const result = await git.commit(message, relativePaths);
  if (!result.commit) {
    throw new Error(
      "git resolved the commit with no commit hash — nothing was actually committed",
    );
  }
}

/**
 * Rolls back exactly what this `initVault` run did — and nothing else
 * — after a failed write, a failed `validateBoot`, or a failed initial
 * commit, so a re-run resumes cleanly instead of being refused by
 * check 3 ("already has .memory/rules.md") over a half-finished
 * attempt. Every step is best-effort: rollback must make as much
 * progress as possible even if an individual step fails (e.g. a file
 * already gone).
 */
async function rollbackScaffold(
  vaultPath: string,
  tracker: ScaffoldTracker,
): Promise<void> {
  // 1. Restore the index to exactly its pre-stage state for whatever
  //    this run staged — NOT `git reset -- <paths>` (resets to HEAD,
  //    which silently drops anything the user had staged that differs
  //    from HEAD; on an unborn branch with no HEAD to reset to, it
  //    drops the staged entry entirely instead of restoring it).
  if (tracker.stagedRelativePaths.length > 0) {
    try {
      const git = simpleGit(vaultPath);
      await restoreIndexEntries(
        git,
        tracker.stagedRelativePaths,
        tracker.preStageIndexEntries,
      );
    } catch {
      // best-effort — proceed with the filesystem rollback regardless
    }
  }

  // 2. Restore (pre-existing) or delete (created fresh) every merged
  //    file — never re-runs the merge.
  for (const { path: filePath, original } of tracker.mergedFiles) {
    try {
      if (original === undefined) {
        await rm(filePath, { force: true });
      } else {
        await writeFile(filePath, original); // raw bytes — never re-encoded
      }
    } catch {
      // best-effort
    }
  }

  // 3. Delete every file this run created from scratch.
  for (const filePath of tracker.createdFiles) {
    await rm(filePath, { force: true }).catch(() => undefined);
  }

  // 4. Delete every directory this run created, deepest first, and
  //    ONLY if it is now empty — a directory that still holds anything
  //    (pre-existing content, or content this run didn't create) is
  //    left exactly as-is. `rmdir` itself already refuses a non-empty
  //    directory (ENOTEMPTY); the try/catch just makes that silent.
  const deepestFirst = [...new Set(tracker.createdDirs)].sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length,
  );
  for (const dirPath of deepestFirst) {
    await rmdir(dirPath).catch(() => undefined);
  }
}

export function registerInitCommand(program: Command): void {
  const log = createLogger();
  program
    .command("init")
    .description(
      "Scaffold .memory/ (rules, templates, config) in a new vault and make the initial commit.",
    )
    .argument("[path]", "vault path (default: current directory)")
    .action(async (target: string | undefined) => {
      const result = await initVault(target ?? ".");
      log.info(`initialized vault at ${path.resolve(result.root)} (${INIT_COMMIT_MESSAGE})`);
    });
}
