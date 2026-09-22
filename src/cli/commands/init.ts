import { existsSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
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
   * content captured before the write — `undefined` means the file did
   * not exist and was created fresh (rollback deletes it); a string
   * means it existed and is restored verbatim (rollback never merges
   * again — it puts back exactly the original bytes).
   */
  mergedFiles: Array<{ path: string; original: string | undefined }>;
  /** Relative paths (from the vault root) this run staged with `git add`. */
  stagedRelativePaths: string[];
}

function newScaffoldTracker(): ScaffoldTracker {
  return { createdDirs: [], createdFiles: [], mergedFiles: [], stagedRelativePaths: [] };
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
  const original = existed ? await readFile(filePath, "utf8") : undefined;
  tracker.mergedFiles.push({ path: filePath, original });

  if (original === undefined) {
    await writeFile(filePath, content, "utf8");
    return;
  }

  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const existingLines = original.split(/\r\n|\n/).map((line) => line.trim());
  const requiredLines = content
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trim())
    .filter((line) => line.length > 0);

  const missingLines = requiredLines.filter(
    (line) => !isEffectivelyPresent(existingLines, line),
  );
  if (missingLines.length === 0) return;

  const separator = original.length > 0 && !original.endsWith(eol) ? eol : "";
  await writeFile(
    filePath,
    `${original}${separator}${missingLines.join(eol)}${eol}`,
    "utf8",
  );
}

/**
 * True when `target` is in effect in `existingLines`: its LAST
 * occurrence (among itself and its `!target` negation) must be the
 * positive form. Absent entirely, or last-negated, counts as NOT
 * present (so it gets re-appended).
 */
function isEffectivelyPresent(existingLines: string[], target: string): boolean {
  const negated = `!${target}`;
  let present = false;
  for (const line of existingLines) {
    if (line === target) present = true;
    else if (line === negated) present = false;
  }
  return present;
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
  // 1. Unstage exactly what this run staged. `git reset -q -- <paths>`
  //    (no ref) never references HEAD, so it is safe on an unborn
  //    branch (a repo with no commits yet) too.
  if (tracker.stagedRelativePaths.length > 0) {
    try {
      const git = simpleGit(vaultPath);
      await git.raw(["reset", "-q", "--", ...tracker.stagedRelativePaths]);
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
        await writeFile(filePath, original, "utf8");
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
