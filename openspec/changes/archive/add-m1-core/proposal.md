# Proposal — add-m1-core (M1: Core, dogfood-ready)

Phase: proposal · Status: complete
Inputs: `openspec/changes/add-m1-core/explore.md`, `docs/RFC.md` v1.2 (§1–§8, §12), `openspec/config.yaml`

---

## Why (Problem & Motivation)

supermemory is specified end-to-end in `docs/RFC.md` v1.2 but does not exist: the repo has zero commits, no `package.json`, no source, no tests. RFC §1–§2 define the product as the *structure layer* over a git-synced Markdown vault — rules-as-markdown ontology, agent-first retrieval, one deterministic sync engine, no editor configuration — and the RFC's own delivery unit for that promise is **M1 "Core (dogfood-ready)" (§12)**: until `init`/`setup`/`serve`/`sync` exist with rules parsing, the six MCP tools, an index rebuilt from the vault, the sync engine with its conflict ladder, and secrets lint, no team (including this one) can validate the core value proposition: agents reading and writing the same validated structure against a real vault. This change delivers exactly that M1 slice and nothing beyond it, establishing the scaffold, conventions, and test infrastructure that M2/M3 will build on.

## Proposed Change

**M1 Core as ONE SDD change** (`add-m1-core`), per the exploration recommendation: M1 is only testable as an end-to-end loop (`save` needs templates + index + Linked Knowledge maintenance; `sync` needs commit grammar over frontmatter), so splitting it into multiple SDD changes would ship no independently valuable slice and force three spec deltas that revise each other. The 400-line review budget is a *review* constraint, not a design one: it is handled by pre-planned chain seams and the `ask-on-risk` pause (see *Delivery note*), not by splitting the change.

### Phase 0 — Baseline commit (before branching)

A single commit on `main` — proposed here, **executed as the first apply task, not in this phase**:

- `chore: baseline docs + openspec`
- Contents: `docs/RFC.md`, `openspec/` (config.yaml + change artifacts), `.gitignore` (including the D2 decisions below), and a minimal `README.md` note that `.atl/` is machine-local.
- Rationale: `main` currently has zero commits — the first feature PR would otherwise mix scaffold/docs with feature code against a non-existent root, and its 400-line budget would measure docs instead of code. Branch diffs need a root commit; `origin` exists.
- **Pushing `main` to `origin` remains a user decision** — the SDD flow commits locally and does not publish.

### Phase 1 (P1) — Scaffold + rules + CLI onboarding + boot validation

Chain seam: PR-1 from the exploration report.

- npm package scaffold: single package `supermemory` (`bin` entry, `engines` pinned to Node LTS, ESM/NodeNext), `src/cli`, `src/rules`, plus design-added `src/config` (RFC §8 global config/env resolution) and boot-validation module (RFC §3) — `src/index`/`src/sync`/`src/mcp` directories land with their phases.
- `rules.md` parsing (v1 format: frontmatter `format_version`, fenced YAML blocks for note types, lifecycle, conflict defaults, git settings) + `{{placeholder}}` template rendering (string interpolation only).
- CLI `init` (scaffold `.memory/`, templates, `config.yml`, `.gitattributes`, default folders, validate, commit) and `setup` (interactive wizard, validated vault path, author identity, writes global config).
- Boot validation: directory exists, git repo, `.memory/rules.md` present, not inside the app repo, `format_version` supported; fail-fast with actionable messages. *(As executed, P1 also shipped an FTS5 capability probe; design OD-5 removes SQLite and task 1.20 removes the probe.)*
- **vitest wiring as an explicit P1 task** (Decision D3).

### Phase 2 (P2) — In-memory index + MCP tool catalog

Chain seam: PR-2 from the exploration report.

- In-memory index built by parsing the vault at boot, incrementally re-parsed on change (design OD-5): property filters, free-text search, wikilink/`spec_id` link graph, plus the committed `index/` Markdown maps (RFC §3–§4, exploration). No index artifact is persisted.
- MCP server (`serve --vault`, single-vault mode) with all six M1 tools generated from `rules.md`: `find`, `read_with_context`, `save`, `changes_since`, `sync`, `status` (RFC §5). Schemas strict via zod; tool descriptions embed the team's prose rules. `save` validates against `rules.md` and maintains the spec's Linked Knowledge section. `sync`/`status` return real engine state once P3 lands (thin wiring may stub until then).

### Phase 3 (P3) — Sync engine + commit grammar + conflict ladder + secrets lint

Chain seam: PR-3 from the exploration report.

- One sync engine shared by CLI and MCP server (RFC §3 invariant 4): debounce (~45s) + interval (~15min, skip-clean when nothing to commit), pull-rebase with autostash, pull-before-write.
- Commit grammar: `note(<add|update|delete>): <type> "<title>" [<id>]` derived deterministically from frontmatter; git author is always the human; agent/client provenance in trailers; generated index regeneration in separate `chore(index)` commits (RFC §6.3).
- Conflict ladder v1 (RFC §6.4): generated files regenerate; append-only logs via `merge=union` + post-merge sort/dedupe; curated-note conflicts → `rebase --abort`, snapshot branch `conflict/<date>-<note-id>`, conflict note written into the vault, guided `supermemory resolve`. **Never silently delete** is the headline invariant and headline test.
- Secrets lint before every commit. CLI `sync` command completes the M1 command set.
- Pidfile lock under `.memory/cache/` (one sync owner per clone); injectable clock/lock seams defined in design for testability.

### MVP scope mapping to RFC §12 milestones

| RFC §12 M1 item | Phase in this change |
|---|---|
| `init`, `setup`, `serve`, `sync` commands; boot validation | P1 (`init`/`setup`/validation), P2 (`serve`), P3 (`sync`) |
| rules.md parsing (v1) + template rendering | P1 |
| `find` / `read_with_context` / `save` / `changes_since` / `sync` / `status` | P2 (catalog) + P3 (sync tool backed by engine) |
| Derived index (properties + free text + links), rebuilt from the vault | P2 |
| Sync engine: debounce + interval, pull-rebase, commit grammar, union/ours gitattributes, conflict ladder v1, guided `resolve` | P3 (`.gitattributes` written by `init` in P1) |
| Secrets lint | P3 |

No M2 or M3 items are included (see *Out of Scope*).

## Capabilities Affected (spec deltas for the specs phase)

Mirroring the exploration's spec-set recommendation:

1. **rules-parsing** — `rules.md` v1 parsing, template rendering, format_version contract surface.
2. **boot-validation** — vault path validation and fail-fast behavior (shared by `setup` and `serve`).
3. **tool-catalog** — the six MCP tools generated from rules, zod schemas, Linked Knowledge maintenance.
4. **index** — in-memory derived index (properties + free text + link graph), built at boot, incrementally updated, no durable state outside the vault.
5. **sync-ladder** — sync engine, debounce/interval triggers, commit grammar, conflict ladder, secrets lint, `resolve` flow.

CLI onboarding (`init`/`setup`/`sync` commands) and package scaffold are covered within these capabilities rather than as separate spec deltas; the specs phase may refine the delta boundaries.

## Decisions & Rationale

- **D1 — Phase-0 baseline commit on `main` before branching.** A zero-commit `main` breaks branch diffs and pollutes the first feature PR's review budget with docs. The commit is additive and docs-only; rollback is a trivial revert on `main`. **Push to `origin` is not part of this decision** — publishing remains a user-owned action at every step.
- **D2 — `.atl/` stays gitignored as machine-local; `.pi/` added to `.gitignore`.** `.atl/skill-registry.md` is auto-generated with machine-specific paths — committing it would churn per machine. `.pi/gentle-ai/sdd-preflight.json` is session-local state; surfacing this in `.gitignore` (rather than silently deciding) keeps the baseline commit honest. A short README note records that `.atl/` is machine-local (non-blocking).
- **D3 — vitest wiring as an explicit P1 task, including flipping `strict_tdd: true` and backfilling `apply.test_command`, `verify.test_command`, and `verify.build_command` in `openspec/config.yaml`.** The config was bootstrapped with `strict_tdd: false` only because no runner existed; the flip belongs to the same task that establishes the runner so TDD gates are active before the first feature code lands in P1.
- **D4 — Add a `yaml` dependency.** Stack gap found in exploration: RFC §8 lists no YAML parser, but `.memory/config.yml` and the fenced YAML blocks in `rules.md` both require one. `yaml` is the choice (js-yaml reuse may be justified in design if a transitive copy is already present). Templates need only string interpolation — no template engine.

## Out of Scope (deferred to M2/M3 per RFC §12)

- Multi-vault mode and the `project` parameter (`serve --multi`, required-`project` tools, `projects_list`).
- `vault_register` / `vault confirm` agent-relayed registration.
- `manual` and `pr` sync modes and strictest-wins `.env` resolution (M1 ships `auto` mode only; the manual `sync` tool/CLI trigger remains available per §6.1).
- MCP elicitation-based first-run; `install --client`; `vault validate` CI mode; `--profile` support; `theirs_and_archive` policy; staleness flags / attic flow; format_version guard + `migrate` (M2).
- Cross-project search (`project: "*"`), optional embeddings module, multi-vault dashboards (M3).

## Rollback Plan

- **Phase 0** (baseline commit, docs-only, on `main` before branching): rollback is `git revert` of the single commit — no code exists to break.
- **P1–P3**: all implementation work happens on branches; `main` remains untouched until a phase is merged. Any phase can be rolled back by **revert-PR** (`git revert` of the merge/commits on a branch, merged through review). Because the repo is greenfield, "full rollback" = `main` back at the phase-0 baseline; no data migrations exist.
- **Nothing outside the repository is mutated** by this change: no `npm publish`, no pushes (user-owned per D1), no remote operations. Tests are hermetic (fixture vaults materialized into `os.tmpdir()`, bare repos in tmp as remotes, env overrides `SUPERMEMORY_CONFIG_DIR`/`SUPERMEMORY_VAULT`). Runtime writes to `~/.config/supermemory` happen only when a user dogfoods `setup`/`serve`, never as part of build/test.
- Per `openspec/config.yaml` archive rule, destructive deltas warn before merge; none are planned.

## Risks (carried from exploration)

1. **Review budget**: M1 realistically 2000+ lines with tests vs. a 400-line budget — mitigated by the pre-planned P1/P2/P3 chain seams and the ask-on-risk pause (below).
2. ~~**better-sqlite3 native install**~~ — **retired by design OD-5**: the in-memory index removes the native dependency entirely, so the prebuild/FTS5 failure mode no longer exists. Task 1.20 removes what P1 shipped for it.
3. **MCP SDK + zod peer incompatibility**: verify the SDK's zod peer range before locking zod 3 vs. 4; pin SDK exact/minor.
4. **Greenfield convention vacuum**: the design doc must fix layout/module conventions before apply (exploration provides the candidate list).
5. **Sync concurrency testability**: pidfile lock and debounce need injectable clock/lock seams defined in design.

## Success Criteria

- `npx supermemory init` scaffolds a valid vault (rules, templates, config, `.gitattributes`); `setup` configures a member end-to-end.
- `serve` boots with full validation and fails fast with actionable messages on every invalid-vault fixture.
- All six tools operate against a real vault: `find` (properties + free text), `read_with_context` (backlinks + linked knowledge), `save` (validated, Linked Knowledge maintained), `changes_since`, `sync`, `status`.
- The index is built from vault contents alone and persists nothing; restarting reproduces identical query results.
- Divergent local/remote commits never lose data: rebase aborted cleanly, snapshot branch created, conflict note visible in the vault, `resolve` completes the cycle.
- Commit messages follow the grammar and are derived deterministically from frontmatter; git author is always the human.
- Secrets lint blocks committing flagged secrets in every mode.
- `vitest` suite green on Node LTS; TDD gates (`strict_tdd`) active from P1 onward.

## Open Decisions Carried into Design

- **CLI library choice** — RFC names none; commander (or similar) to be decided in design.
- **MCP SDK / zod pinning strategy** — exact pin levels, and zod 3 vs. 4 gated on the SDK's declared peer range.
- ~~**better-sqlite3 FTS5 probe details**~~ — resolved as OD-3 in design, then **withdrawn** when OD-5 replaced the SQLite index with an in-memory one.
- **Injectable clock/lock seams** — fake-timer strategy for debounce/interval tests; lock abstraction for pidfile ownership tests.

Additional scaffold inputs carried from exploration (layout incl. `src/config`, ESM/NodeNext, `package.json` shape, `.gitignore`-in-vault contents) are design-doc material, not proposal decisions.

## Delivery Note (explicitly not decided here)

Delivery chaining is **not** chosen in this proposal. P1/P2/P3 are pre-planned seams so chaining is mechanical if needed. Per session preflight (`ask-on-risk`), the tasks phase forecast will estimate line counts per phase; if the 400-line review budget is at risk — it is expected to be — the flow pauses and asks for a delivery decision rather than inventing a chain strategy or an exception.

---

*No code changes, no commits, and no pushes were made in this phase. The phase-0 commit is proposed as the first apply task.*
