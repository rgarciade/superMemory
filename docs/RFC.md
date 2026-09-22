# RFC: supermemory — A Team Knowledge Layer over a Git-Synced Obsidian Vault

Status: Draft v1.2 (multi-vault serving + `project` parameter; agent-relayed vault confirmation; configurable sync modes `auto`/`manual`/`pr` with strictest-wins)
Author: supermemory maintainers
Target stack: Node.js LTS, TypeScript, MCP (Model Context Protocol)

---

## 1. Summary & Positioning

supermemory is a local MCP server that gives AI agents structured, validated,
and searchable access to a team knowledge vault stored as **plain Markdown in a
private Git repository** (typically an Obsidian vault — though Obsidian itself
is optional; any editor works).

**What it is NOT:** another generic Obsidian CRUD MCP server. Several of those
already exist (obsidian-mcp variants, Basic Memory). They give agents files;
they do not give a team a *shared structure*.

**What it IS:** the *structure layer* on top of a vault.

1. **Rules-as-markdown** — the team's ontology (note types, required fields,
   naming, lifecycle, conflict policies) lives in an editable `rules.md` inside
   the vault. The server derives its templates, validation, and even tool
   descriptions from it. Change the file → every agent on the team changes
   behavior. No code, no redeploy.
2. **Agent-first retrieval** — typed notes, frontmatter property index,
   wikilink graph, and full-text search, exposed through tools designed for
   agents (`find`, `read_with_context`, `changes_since`).
3. **Git-native team sync** — one deterministic sync engine shared by CLI and
   server, with per-note-type conflict policies and a strict
   *never-silently-delete* invariant.
4. **Zero editor configuration** — Obsidian needs no plugins and no setup. The
   vault is just a folder that happens to be a Git repo.

The app itself is **stateless and disposable** (see §3 Invariants): it never
stores memories. Everything durable lives in the vault repo or in a tiny global
config of pointers.

---

## 2. Goals & Non-Goals

### Goals

- A team member clones the memory repo and is productive in under a minute,
  with zero Obsidian configuration.
- Every agent (Cursor, Claude Code, Codex, Slack bot, …) reads and writes the
  same structure, validated against the same rules, regardless of client.
- Spec documents act as **index hubs**: episodic knowledge (decisions,
  incidents, learnings) links explicitly to specs via `spec_id`, and reading a
  spec automatically surfaces its linked knowledge.
- Human-editable ontology: changing team rules is a one-file edit + commit.
- Deterministic core: no LLM calls, no embeddings, no API keys, no cloud.
  Behavior is fully reproducible.

### Non-Goals

- No internal AI: the server never summarizes, embeds, or interprets. Retrieval
  is structural (FTS5 + property index + link graph). Embeddings may arrive as
  an optional opt-in module later; the default stays deterministic.
- No proprietary UI. Obsidian (or any editor) is the human UI. Obsidian Bases
  gives humans database views for free over standard frontmatter.
- Not a task tracker, not a wiki engine, not a cloud product.
- No sync infrastructure beyond Git. If you need real-time multi-user editing,
  this is the wrong tool.

---

## 3. Architecture Overview

```
┌─────────────┐   ┌─────────────┐   ┌──────────────┐
│   Cursor    │   │ Claude Code │   │  Slack bot   │   … any MCP client
└──────┬──────┘   └──────┬──────┘   └──────┬───────┘
       │  stdio (one server process per client, per vault)
       └────────────────┬┴──────────────────┘
                        ▼
              ┌───────────────────┐        ┌──────────────────────┐
              │  supermemory MCP  │───────▶│  ~/.config/supermem  │
              │  (stateless, TS)  │        │  /config.json        │
              │                   │        │  pointers + identity │
              │  · rules engine   │        └──────────────────────┘
              │  · tool catalog   │
              │  · sync engine    │        ┌──────────────────────┐
              │  · search index   │───────▶│  VAULT (private Git  │
              └─────────┬─────────┘        │  repo, per team)     │
                        │                  │                      │
                        │  read/write      │  notes (*.md)        │
                        │  git -C vault    │  .memory/rules.md    │
                        ▼                  │  .memory/templates/  │
              ┌───────────────────┐        │  .memory/cache/      │
              │  Git remote       │◀──────▶│  (.gitignored index) │
              │  (GitHub/GitLab)  │ push/  └──────────────────────┘
              └───────────────────┘ pull
                        ▲
        Humans: Obsidian / VS Code / any editor opens the same folder;
        `supermemory sync` or plain `git push` publishes manual edits.
```

### Invariants

1. **The vault is the single source of truth.** All notes, rules, and templates
   are Markdown in the vault repo. The SQLite cache under
   `.memory/cache/` (gitignored) is a derived index, rebuildable at any time.
2. **The app never stores memories.** Outside the vault it writes exactly two
   things: the global config (pointers + author identity) and logs. No notes,
   no copies, no telemetry, no shadow stores. Deleting the app loses nothing.
3. **Direct filesystem access** to the vault. No dependency on the Obsidian
   Local REST API or any plugin. Works whether or not Obsidian is running.
4. **One sync code path.** The CLI (`supermemory sync`) and the MCP server call
   the same engine. Never two divergent sync logics.
5. **Never silently delete.** No conflict policy discards information without
   either merging it deterministically or archiving it visibly (§6).

### Boot-time validation

On startup the server validates the resolved vault path:

- it is an existing directory,
- it is a Git repository,
- it contains `.memory/rules.md`,
- it is **not located inside** the supermemory source repository (guards
  against accidentally committing private notes to a public repo),
- the vault's `format_version` is supported by this server build (§4.4).

Failure is fail-fast with an actionable message.

---

## 4. Vault Layout & the `rules.md` Contract

### 4.1 Directory layout

```
<vault>/
├── .memory/
│   ├── rules.md            # team ontology (committed, versioned)
│   ├── templates/          # note templates (committed)
│   ├── config.yml          # sync + policy settings (committed)
│   ├── local.json          # per-user author identity (gitignored)
│   └── cache/              # derived SQLite index (gitignored)
├── specs/                  # living specifications (index hubs)
├── decisions/              # ADR-style micro-decisions
├── incidents/              # bug / incident records
├── learnings/              # durable lessons about the codebase
├── facts/                  # project facts (stack, owners, environments)
├── logs/                   # append-only session/incident logs
└── index/                  # GENERATED maps of content (never hand-edited)
```

Folder names and note types are declared in `rules.md`; the above is the
default scaffold created by `supermemory init`.

### 4.2 `rules.md` format

Markdown with typed YAML blocks: prose for humans (rendered nicely in
Obsidian), YAML for the engine. `format_version` uses its own semver,
independent of the product version.

```markdown
---
format_version: 1.0
---

# Team Memory Rules

Prose explanation the team can read and discuss. Everything the engine
needs is in the blocks below.

## Note types

```yaml
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
```

## Lifecycle

```yaml
lifecycle:
  staleness:
    field: review_after
    on_stale: flag          # surfaced by the `find` tool and status reports
  archive:
    folder: attic/
    policy: manual          # or `auto` per type
```

## Conflict policies

```yaml
conflict_policy_defaults:
  generated_indexes: regenerate
  session_logs: union
  decisions: human_required
  specs: human_required
  daily_notes: theirs_and_archive   # remote wins; local side archived in attic/
```

## Git

```yaml
git:
  mode: auto              # auto | manual | pr  (team policy; see §6.1)
  sync_interval_minutes: 15
  debounce_seconds: 45
  commit_language: en
  secrets_lint: true
  generated_paths: [index/, .memory/cache/]
```
```

### 4.3 Note templates and frontmatter

Templates in `.memory/templates/<type>.md` may contain frontmatter and body
skeletons with `{{placeholders}}`. Example for `decision`:

```markdown
---
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
```

The spec template includes the hub section that closes the bidirectional loop:

```markdown
## Linked Knowledge

Auto-maintained index of decisions, incidents, and learnings that reference
this spec (by spec_id). The `save` tool appends entries here when they are
created with this spec_id.
```

All frontmatter uses standard Obsidian property types, so Obsidian Bases can
render team dashboards (all open incidents, all specs by status) with zero
extra tooling.

### 4.4 The format-version contract

Because team members may run different supermemory versions against the same
vault, the vault declares the contract:

- `rules.md` carries `format_version` (semver of the *rules format*).
- On every sync and boot, the server checks it. If the vault requires a newer
  format than the binary supports → refuse with
  `vault requires format 2.x — run supermemory upgrade / update the app`.
- Minor/patch bumps must stay backward compatible; major bumps ship with a
  migration command (`supermemory migrate`).

### 4.5 `.gitattributes` (created by `init`, lives in the vault)

```gitattributes
logs/**     merge=union     # append-only: both sides concatenated
index/**    merge=ours      # generated: regenerating after merge is fine
```

---

## 5. MCP Tool Catalog

Tools are **generated from `rules.md`**: each note type's required fields
become the JSON Schema of the corresponding save operation, and tool
descriptions embed the team's own prose rules. All schemas are strict
(declared with zod, exposed as JSON Schema).

| Tool | Purpose |
|---|---|
| `find` | Structured search over the property index: filters by `type`, `status`, `spec_id`, `tags`, `owner`, date ranges; plus FTS5 free-text. Returns id, title, status, path. |
| `read_with_context` | Returns a note plus: its frontmatter, a summary of backlinks (wikilinks and `spec_id` references), the status/lifecycle info of referenced specs, and the N most recent linked decisions/incidents. Reading a spec gives you its knowledge neighborhood. |
| `save` | Create/update a note of a declared type. Validates against `rules.md` (required fields, patterns, naming, folder). Rejects non-conforming writes with the violated rule. Maintains the spec's Linked Knowledge section when `spec_id` is set. |
| `changes_since` | What changed in the vault since a timestamp or "my last session" — the continuity primitive for agents. Diff summary at note granularity (added/updated/status changed). |
| `sync` | Trigger a sync cycle immediately (pull-rebase, commit pending writes, push). Returns sync status. |
| `status` | Last successful sync, pending local writes, unresolved conflicts, stale notes flagged by lifecycle rules, vault format version. |

### 5.1 Multi-vault mode and the `project` parameter

One server can serve a single vault (`serve --vault <path|name>`) or every
registered vault (`serve --multi`). Both modes share the same global registry
(`vaults` in the global config) and the same rules engine; the tool catalog
adapts at launch:

- **Single-vault mode**: tools take no `project` argument.
- **Multi-vault mode**: `project` is a **required** argument on every data
  tool (`find`, `read_with_context`, `save`, `changes_since`). Never optional
  with a default: a defaulted project is how notes silently land in the wrong
  vault. An unknown name fails with the list of registered projects so the
  agent can ask instead of guessing.

Registration is human-owned. `supermemory vault add <name> <path>` (or the
setup wizard) registers a vault directly. The `vault_register` tool lets an
agent *propose* a mapping (validated: git repo, `.memory/` present, not inside
the app repo), which becomes a **pending** entry activated once by a human via
`supermemory vault confirm <name>`. The tool never overwrites an existing
mapping — a hallucinated path must never silently redirect a team's memory.

The confirmation UX is agent-relayed: `vault_register`'s response includes the
exact `pending_command` to run, plus what will be registered (name, path,
validations, the agent's stated reason). The agent either relays it to the
human, or runs it through its own shell — where the MCP client's native
command-approval gate **is** the human confirmation. The server never exposes
a confirm *tool*: an agent must never be able to propose and confirm in the
same turn.

| Tool | Purpose |
|---|---|
| `projects_list` | Registered vaults: name, path, last sync, format version. Read-only; lets an agent discover and disambiguate the project it is working on. |
| `vault_register` | Proposes a new name→path mapping as a pending entry; its response returns the exact `pending_command` for the human to run (or to approve via the agent's shell gate). Cannot modify or overwrite existing mappings. |

Cross-project search (`project: "*"`) is a future extension, not MVP.

Additionally:

- **Resources**: `rules://current` exposes the parsed rules and templates so
  clients can read team conventions on demand.
- **Server instructions**: the server sends a per-profile instruction block
  (see §7.4) describing the workflow: *consult the spec before coding; record
  every decision or surprise linked to its `spec_id`*.

Deliberately absent: free-form `write_file`/`delete_file` tools. All mutations
go through typed, validated operations — that is the product.

---

## 6. Sync Engine

### 6.1 Sync modes and triggers

Sync behavior is governed by `sync.mode` — `auto` (default), `manual`, or
`pr` — resolved from two layers (§8): the vault's committed `config.yml`
(team policy) and the local `.env` (general + per project). Precedence rule:
**the strictest mode wins**, regardless of layer — a local `.env` can never
relax a team's review policy, and personal caution always applies. The
lattice: `auto` < `manual` < `pr`.

- **`auto`** — post-write debounce (~45s, configurable): the primary
  trigger, pushing shortly after the agent writes so a closed laptop loses at
  most the debounced window; plus interval fallback (default 15 min) that
  skips cleanly when there is nothing to commit (no empty commits, no cron
  noise).
- **`manual`** — the engine never touches Git on its own. Writes remain
  pending (counted by `status`); the full pull-commit-push cycle runs only
  when a human triggers `sync` (tool or CLI).
- **`pr`** — commits and pushes automatically, but to a per-agent branch +
  pull request; never to main. For projects that want formal review of
  memory changes.

In every mode, manual `supermemory sync` / the `sync` tool remains available,
and secrets lint runs on every sync regardless of mode.

### 6.2 Ownership & locking

One sync owner per vault clone. The server holds a lock (pidfile under
`.memory/cache/`); if a user runs the CLI while the server owns sync, the CLI
delegates or reports — two sync engines never race on the same clone.
In multi-vault mode (§5.1) each vault keeps its own lock and its own debounce
timers; a failing sync in one vault never blocks another.

### 6.3 Commit generation

One commit **per write event**, not per tick. Messages are derived
deterministically from frontmatter — no LLM, no free text from the agent:

```
note(add): decision "FTS5 instead of embeddings for search" [DEC-0042]

Author: Raul Garcia
Via: cursor (claude-sonnet)
Spec: SPEC-search-002
```

- Header grammar: `note(<add|update|delete>): <type> "<title>" [<id>]`;
  updates include the meaningful change (`spec SPEC-auth-003 draft→active`).
- **Git author is always the human** (from `.memory/local.json` or inherited
  git config). Agent/client provenance goes in trailers. `git blame` must show
  people, not a bot.
- Generated index regeneration lands in separate commits:
  `chore(index): regenerate maps (23 notes)`.
- `git log --grep="DEC-0042"` becomes a query interface.

### 6.4 Conflict resolution ladder

Engine flow: `git -C <vault> pull --rebase --autostash` before every push, and
**pull-before-write** when an agent updates an existing note (edits always
start from the latest known remote version — this kills most races before they
exist). Then, by file category:

1. **Generated files** (`index/`): take either side, finish the rebase,
   regenerate deterministically. Zero human involvement.
2. **Append-only logs**: `.gitattributes` `merge=union` concatenates both
   sides; a post-merge pass sorts by timestamp and dedupes by entry id.
3. **Curated notes (specs, decisions)** with a same-region conflict:
   - `rebase --abort` (local state intact, nothing lost),
   - snapshot the incoming side as `conflict/<date>-<note-id>`,
   - write a **conflict note into the vault itself** (visible in Obsidian,
     no git knowledge required) and surface it via the `status` tool,
   - guided resolution: `supermemory resolve` opens both sides side by side,
     the human merges, the command finalizes (commit + push). Git experts can
     resolve manually — it is a normal repo.
   - Vault reads/writes continue locally during resolution; only push pauses.
4. **Escape-hatch policy** (`theirs_and_archive`, opt-in per type): remote
   wins, local side preserved under `attic/` with a timestamp. Available for
   ephemeral types where a team prefers zero friction over human review.

Invariant across all policies: **no silent deletion**.

### 6.5 Hygiene

- Secrets lint runs in the engine before every commit, in both modes.
- Network failures retry with backoff; `status` reports last successful sync.
- No force-push, ever.

---

## 7. Onboarding & Lifecycle

### 7.1 One-time project setup (architect)

```
git clone <vault-url> && cd <vault>   # or mkdir a new repo
npx supermemory init
#   → scaffolds .memory/ (rules.md, templates, config.yml, .gitattributes),
#     default folders, validates, commits
git push
```

From this point **all configuration lives in the repo**. Team members inherit
the ontology by cloning.

### 7.2 Per member

```
git clone <vault-url>
npx supermemory setup        # one-time terminal wizard:
#   · vault path (validated: git repo, .memory present; init offered if empty)
#   · author identity (defaults to the user's git config)
#   · writes ~/.config/supermemory/config.json
npx supermemory install --client cursor
#   → writes the MCP entry into the client config, wired to the vault
npx supermemory vault add acme /path/to/acme-memory
#   → registers more projects in the same global config
#     (`vault confirm` activates agent-proposed pending registrations)
```

The MCP server itself is **never interactive**: stdin belongs to the protocol.
If launched without configuration it fails fast with
`No vault configured. Run: supermemory setup`. (Where a client supports MCP
elicitation, the server may offer the path question natively — progressive
enhancement only; the CLI wizard is the guaranteed path.)

### 7.3 Two first-class usage modes

- **Agent mode**: the MCP server runs, syncs automatically (§6). The member
  does nothing else.
- **Manual mode**: open the vault folder with Obsidian — or any editor, no
  plugins — edit, then `supermemory sync` or plain `git push`.

Nobody configures Obsidian. Obsidian is not even required.

### 7.4 Client profiles (optional)

Because each client launches its own server process, a profile flag costs no
configuration: `--profile reporter|engineer` (default: `engineer`).

- **Varies by profile**: tool descriptions and examples, default templates,
  validation strictness, server instruction text. A Slack `reporter` gets a
  capture-oriented workflow (log an incident, record a decision from a thread);
  a coding `engineer` gets the full spec-linked workflow.
- **Never varies**: storage location and the base structural contract — every
  profile validates against the same `rules.md`, or the "one structure for the
  whole team" promise breaks.

Profiles are declared in `.memory/config.yml`.

### 7.5 Updating

The app holds no state (§3 Invariants): updating means replacing the binary /
pulling the latest npm version. Global config survives; data lives in the
vault; the `format_version` contract protects against member/version drift
(§4.4). `npx supermemory@latest` is a complete update.

---

## 8. Configuration Reference

**Launch modes**: `serve --vault <path|name>` serves exactly one vault;
`serve --multi` serves every registered vault (§5.1). With no flag:
`SUPERMEMORY_VAULT` env → `vaults.default` in global config.

```jsonc
// ~/.config/supermemory/config.json  (per user, outside any repo)
{
  "vaults": {
    "default": "/Users/raul/memory-vault",
    "acme":    "/Users/raul/work/acme-memory"
  },
  "author": { "name": "Raul", "email": "raul@example.com" }
}
```

Environment variables:

| Var | Purpose |
|---|---|
| `SUPERMEMORY_VAULT` | Vault path override (also used for dev dogfooding via `.env` in the source repo — `.env` is always gitignored; `.env.example` documents it). |
| `SUPERMEMORY_SYNC_MODE` | Local override of the sync mode (`auto` \| `manual` \| `pr`), general. Strictest-wins against the vault's committed policy (§6.1). |
| `SUPERMEMORY_SYNC_MODE__<PROJECT>` | Per-project local override, e.g. `SUPERMEMORY_SYNC_MODE__ACME=manual` (project name uppercased, dashes → underscores, `__` separator). |
| `SUPERMEMORY_CONFIG_DIR` | Override config directory (defaults to `~/.config/supermemory`). |
| `SUPERMEMORY_LOG_LEVEL` | `error` \| `warn` \| `info` \| `debug`. |

The engine loads `~/.config/supermemory/.env` (if present) before real
environment variables; the source repo's own `.env` serves dev dogfooding.
Team-level sync policy lives in the vault's committed `.memory/config.yml`
(`git.mode`), so it travels with the vault — local `.env` is for machine and
personal preferences only.

Client integration (written automatically by `supermemory install`):

```jsonc
// .cursor/mcp.json  (or claude_desktop_config.json — same shape)
{
  "mcpServers": {
    "supermemory": {
      "command": "npx",
      "args": ["-y", "supermemory@latest", "serve", "--vault", "/Users/raul/memory-vault"]
    }
  }
}
```

```jsonc
// Or one entry for every registered project (data tools then require `project`)
{
  "mcpServers": {
    "supermemory": {
      "command": "npx",
      "args": ["-y", "supermemory@latest", "serve", "--multi"]
    }
  }
}
```

Tech stack: Node.js LTS, TypeScript, `@modelcontextprotocol/sdk`, `zod`
(schemas), `simple-git` (git operations), `gray-matter` (frontmatter),
`better-sqlite3` (derived index: property tables + FTS5 + link graph).

---

## 9. Consumer Agent System Prompt

Ship as `.memory/templates/agent-instructions.md` (referenced by the server's
instruction block; teams edit freely):

```markdown
# Working with the team memory vault

Before writing any code for this project:

1. `find` the specs that govern the area you are touching and
   `read_with_context` them. You are accountable to the linked decisions and
   incidents, not just to the code you can see.
2. If something in the code contradicts a spec, STOP and report it — do not
   silently "fix" either side.

While you work:

3. Every non-obvious decision, discovered constraint, bug root cause, or
   legacy-behavior surprise MUST be recorded via `save` with the `spec_id`
   of the spec it belongs to. If no spec applies, say so explicitly.
4. At session end, check `changes_since` your session start and make sure
   everything you learned is either already in the vault or saved now.

Never: invent spec_ids, edit files under index/ (generated), or push git
commands yourself — the server owns sync.
```

---

## 10. Security & Trust

- The app writes nothing outside §3's two exceptions. Stated as a README
  pledge.
- Boot validation refuses vault paths inside the supermemory source repo.
- Secrets lint before every commit.
- The vault is a private repo; access control is Git's problem (per-team
  remotes, branch protection if desired). supermemory adds no auth surface.
- Tiered governance: vault-committed `git.mode: manual|pr` plus local `.env`
  overrides with strictest-wins resolution — agents cannot silently relax a
  team's review policy.

---

## 11. Risks & Prior Art

| Risk | Mitigation |
|---|---|
| Concurrent edits to the same note by agent + human | Atomic note design, deterministic naming, pull-before-write, conflict ladder (§6.4). Conflicts are rare by construction; never destructive. |
| Adoption decay (agents skip the rules; vault becomes a graveyard) | Validation on every write (agents cannot bypass structure), `vault validate` CI command (same rules at PR level), staleness flags, consumer prompt shipped with the product. |
| Maintenance treadmill (MCP spec churn, Obsidian evolution, competitor motion) | Positioning as the structure layer, not another obsidian CRUD server; minimal surface (6 tools); deterministic core with no model dependencies. |
| Version drift across members | `format_version` contract + fail-fast guard + `migrate` (§4.4). |

Adjacent prior art and why they don't cover this: Obsidian MCP servers
(6+, generic CRUD, no team ontology, no rules-as-config); Basic Memory
(markdown + MCP + teams, but generic notes, not spec-centric, teams = cloud);
SpecMem (living specs + memory, hackathon-grade, no git-native team sync);
Obsidian Git plugin (per-user editor config — exactly what we avoid);
GitHub Spec Kit (SDD process artifacts, no memory linkage). The rules-as-
markdown ontology + agent-first retrieval + git-native sync with per-type
conflict policies is the unoccupied slot.

---

## 12. MVP Scope & Milestones

**M1 — Core (dogfood-ready)**
- `init`, `setup`, `serve`, `sync` commands; boot validation
- rules.md parsing (v1 format) + template rendering
- `find` / `read_with_context` / `save` / `changes_since` / `sync` / `status`
- SQLite derived index (properties + FTS5 + links), rebuildable
- Sync engine: debounce + interval, pull-rebase, commit grammar, union/ours
  gitattributes, conflict ladder v1 (generated + logs automatic; curated →
  guided `resolve`)
- Secrets lint

**M2 — Team hardening**
- `install --client` for Cursor / Claude Code / Claude Desktop
- Multi-vault mode: `serve --multi`, required `project` argument,
  `projects_list` / `vault_register` (pending) + `vault confirm`
- Sync modes: `manual` (pending-write tracking, human-triggered cycles) and
  strictest-wins resolution across vault policy + `.env`
- `vault validate` (CI mode) + `--profile` support
- `theirs_and_archive` policy, staleness flags, attic flow
- format_version guard + `migrate`

**M3 — Polish / optional**
- Elicitation-based first-run where clients support it
- Optional embeddings module (opt-in, never default; §2)
- `pr` sync mode (branch + pull-request automation), `project: "*"` cross-project search, multi-vault dashboard helpers, Bases example packs

---

*End of RFC.*
