import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

  // scaffold .memory/ — config.yml and templates are never clobbered if
  // they somehow already exist (write-if-absent); rules.md is always
  // fresh here (guarded by check 3 above).
  const memoryDir = path.join(vaultPath, ".memory");
  const templatesDir = path.join(memoryDir, "templates");
  await mkdir(templatesDir, { recursive: true });

  const writtenPaths: string[] = [rulesPath];
  await writeFile(rulesPath, RULES_MD, "utf8");

  const configPath = path.join(memoryDir, "config.yml");
  await writeIfAbsent(configPath, CONFIG_YML);
  writtenPaths.push(configPath);

  for (const [name, content] of Object.entries(TEMPLATES)) {
    const templatePath = path.join(templatesDir, name);
    await writeIfAbsent(templatePath, content);
    writtenPaths.push(templatePath);
  }

  // default folders (conflicts/ top-level: visible in Obsidian)
  for (const folder of DEFAULT_FOLDERS) {
    const folderPath = path.join(vaultPath, folder);
    await mkdir(folderPath, { recursive: true });
    const gitkeepPath = path.join(folderPath, ".gitkeep");
    await writeIfAbsent(gitkeepPath, "");
    writtenPaths.push(gitkeepPath);
  }

  // vault-level git files — merge missing lines into any pre-existing
  // file instead of overwriting it (a vault root may already have its
  // own .gitignore/.gitattributes for unrelated reasons).
  const gitignorePath = path.join(vaultPath, ".gitignore");
  await mergeMissingLines(gitignorePath, VAULT_GITIGNORE);
  writtenPaths.push(gitignorePath);

  const gitattributesPath = path.join(vaultPath, ".gitattributes");
  await mergeMissingLines(gitattributesPath, GITATTRIBUTES);
  writtenPaths.push(gitattributesPath);

  // validate the fresh vault (five checks), then make the initial
  // commit — staging ONLY the scaffold paths we just wrote, never
  // `git add .` (which would also stage anything else sitting
  // untracked in the vault, previously-ignored files included).
  try {
    await validateBoot(vaultPath);
    const git = simpleGit(vaultPath);
    const relativePaths = writtenPaths.map((p) => path.relative(vaultPath, p));
    await commitInitScaffold(git, relativePaths, INIT_COMMIT_MESSAGE);
  } catch (err) {
    await rollbackScaffold(memoryDir);
    if (err instanceof AppError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new AppError(
      "BOOT_VALIDATION_FAILED",
      `the initial commit failed in "${vaultPath}": ${reason}`,
      {
        hint: "The scaffold was rolled back — fix the underlying issue (e.g. git identity: git config user.name / user.email, or a rejecting commit hook) and re-run `supermemory init`.",
        cause: err,
      },
    );
  }

  return { committed: true, root: vaultPath };
}

/** Writes `content` to `filePath` only if it does not already exist. */
async function writeIfAbsent(filePath: string, content: string): Promise<void> {
  if (existsSync(filePath)) return;
  await writeFile(filePath, content, "utf8");
}

/**
 * Writes `content` to `filePath` if it does not exist; otherwise
 * appends only the lines from `content` that are not already present,
 * so a pre-existing file (e.g. a vault root's own `.gitignore`) never
 * loses its own entries.
 */
async function mergeMissingLines(filePath: string, content: string): Promise<void> {
  if (!existsSync(filePath)) {
    await writeFile(filePath, content, "utf8");
    return;
  }
  const existing = await readFile(filePath, "utf8");
  const existingLines = new Set(
    existing
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  const missingLines = content
    .split("\n")
    .filter((line) => line.trim().length > 0 && !existingLines.has(line.trim()));
  if (missingLines.length === 0) return;
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(
    filePath,
    `${existing}${separator}${missingLines.join("\n")}\n`,
    "utf8",
  );
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
 * Best-effort rollback of the `.memory/` scaffold after a failed
 * post-write guard (validateBoot) or a failed initial commit, so a
 * re-run resumes cleanly instead of being refused by check 3
 * ("already has .memory/rules.md") over a half-committed attempt.
 */
async function rollbackScaffold(memoryDir: string): Promise<void> {
  await rm(memoryDir, { recursive: true, force: true });
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
