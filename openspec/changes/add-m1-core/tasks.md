# Tasks — add-m1-core (M1: Core, dogfood-ready)

Phase: tasks · Status: complete
Inputs: `design.md` (§1 modules/conventions, §2 OD-1–OD-4, §3 boundaries, §4 sync, §5 MCP, §7 data contracts, §8 phase mapping), `specs/*/spec.md` (five capabilities), `proposal.md` (D1–D4, P1/P2/P3 seams), `explore.md` (testing strategy), `openspec/config.yaml` (tasks rules).

Conventions:
- Every code task names its owning module path (design §1). Capabilities tagged `[rules-parsing]` `[boot-validation]` `[tool-catalog]` `[index]` `[sync-ladder]`.
- Tests live with the code they test (`test/<module>/*.test.ts`, one work unit = code + tests + commit). From task 1.3 onward `strict_tdd: true` — subsequent code tasks run RED → GREEN → REFACTOR (failing test first).
- Each task is completable in one focused session. M1 scope only (design §10 non-goals).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~8,000–9,000 total (P0 ~2,700 · P1 ~1,850 · P2 ~1,800 · P3 ~2,200) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (P1) → PR 2 (P2) → PR 3 (P3) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

Every implementation phase independently exceeds the 400-line review budget (per-phase detail at end of file). Per session preflight (`ask-on-risk`) the parent pauses for the delivery decision before apply; no chain strategy and no size exception are chosen here. The P1/P2/P3 seams below are pre-planned so chaining is mechanical if selected.

---

## Phase 0 — Baseline commit (on `main`, before branching)

- [x] 0.1 Baseline commit on `main` — `chore: baseline docs + openspec` (D1): stage `docs/` (RFC.md), `openspec/` (config.yaml + change artifacts), `.gitignore` (D2: `.atl/` stays ignored as machine-local; `.pi/` added), and a minimal `README.md` note that `.atl/` is machine-local. Verify: exactly one commit, clean `git status`. No push — publishing stays user-owned.  — done: root commit `a1fd6be`, clean tree; branch `add-m1-core/pr1-scaffold-rules-boot` created from it.

## Phase 1 (P1) — Scaffold + rules + CLI onboarding + boot validation (PR-1)

Scaffold & toolchain:

- [x] 1.1 Package scaffold per design §1.1/§1.4/§1.7 — `package.json` (`supermemory`, `"type": "module"`, `engines.node >=22`, `bin` → `dist/cli/index.js`, `files: ["dist"]`, no `exports` map), `tsconfig.json` (NodeNext, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, includes `src` + `test`), `tsconfig.build.json` (`src` → `dist`), `vitest.config.ts` (`testMatch: test/**`, no globals — explicit imports), `.env.example` (SUPERMEMORY_* knobs), scripts `test`/`test:watch`/`typecheck`/`build`/`dev`. One trivial passing test proves the runner. — done: `npx tsc --noEmit` clean; `vitest run` 1/1 passed.
- [x] 1.2 Dependency install with OD-2 verification — `npm view @modelcontextprotocol/sdk@latest version peerDependencies --json`; pick the zod major mechanically from the SDK peer range (if both 3 and 4 satisfy → 3); `@modelcontextprotocol/sdk` exact pin, `zod` single-major tilde pin, `better-sqlite3` minor-range pin constrained to prebuilds (darwin-arm64 + linux-x64, Node 22 — verify install needs no node-gyp), caret pins for `commander`/`@inquirer/prompts`/`simple-git`/`gray-matter`/`yaml`. Gate: `npm install --dry-run` resolves with zero peer conflicts, no `--legacy-peer-deps` — any conflict aborts this task for a design note. Then FTS5 smoke probe on Node LTS (in-memory DB, `CREATE VIRTUAL TABLE … USING fts5`, default-import interop = ESM smoke). Record resolved SDK/zod/better-sqlite3 trio in the task notes; commit the lockfile. — done. Resolved trio: **@modelcontextprotocol/sdk 1.30.0 (exact)** · **zod 3.25.76 (~3.25.76)** · **better-sqlite3 13.0.3 (^13.0.3)**. SDK peers: `zod: "^3.25 || ^4.0"` → both majors satisfy → rule picked 3. Dry-run: 186 pkgs, 0 conflicts, exit 0. Prebuilds bundled in-package (`prebuilds/darwin-arm64.node`, `linux-x64.node`, …) — no node-gyp by construction. FTS5 smoke on Node v22.23.2: sqlite 3.53.4, FTS5 virtual table created, CJS default-import interop OK. Caret pins: commander ^15.0.0 · @inquirer/prompts ^8.7.2 · simple-git ^3.36.0 · gray-matter ^4.0.3 · yaml ^2.9.1.
- [x] 1.3 D3 config backfill — in `openspec/config.yaml` flip `strict_tdd: true`, set `apply.test_command: "vitest run"`, `verify.test_command: "vitest run"`, `verify.build_command: "npm run build"`, `apply.tdd: true`. TDD gates active for all later tasks. — done: commit 92f590a.

Test infrastructure (design §1.6/§1.8, hermetic — no network, no HOME writes):

- [x] 1.4 `test/helpers/create-test-vault.ts` + `test/fixtures/vault/` — `createTestVault()`: committed fixture assets (rules.md, templates/, config.yml, .gitattributes, folder skeleton — never a nested `.git`) copied into `mkdtemp(os.tmpdir())`, `git init` + local identity, `commit.gpgsign false`, fixed author/committer dates, optional note seeds; returns `{ root, paths, cleanup }` that closes DB handles before deletion. — done: commits 4df509a/045167c; 5 helper tests green. Note: simple-git 3.x exposes no public env seam, so fixed-date commits use a scoped execFile env (no process.env mutation). Fixture `.gitattributes` uses standalone comments (RFC §4.5 inline `#` is invalid gitattributes syntax).
- [x] 1.5 `test/helpers/create-remote.ts` + `test/helpers/env.ts` — `createRemote()`: `git init --bare` in tmp + clones over local paths + divergent-clones helper (local ahead and remote ahead on the same note region). `withTestEnv({ configDir, vault }, fn)`: sets/restores `SUPERMEMORY_CONFIG_DIR`/`SUPERMEMORY_VAULT`. — done: commit 045167c; 6 helper tests green (divergence fetch added so origin/main is current).

Shared utilities:

- [x] 1.6 `src/util/errors.ts` — `AppError { code, message, hint }` + stable codes (`RULES_PARSE_ERROR`, `FORMAT_VERSION_UNSUPPORTED`, `BOOT_VALIDATION_FAILED`, `SQLITE_FTS5_MISSING`, `SECRETS_BLOCKED`, `LOCK_HELD`, `CONFLICT_CURATED`, `NO_VAULT_CONFIGURED`). RED→GREEN. — done: commit 20d960d; 4/4 (RED: module missing).
- [x] 1.7 `src/util/clock.ts` (`Clock` + `TimerPort` ports; production impl `.unref()`s every timer), `src/util/log.ts` (stderr-only logger, `SUPERMEMORY_LOG_LEVEL`), `src/util/paths.ts` (`.memory` layout helpers). — done: commit 06c8c58; 17/17 group tests (RED: 3 files failing on missing modules).

Rules capability:

- [x] 1.8 `src/rules/version.ts` — `checkFormatVersion`: same-major accepted, higher-major refused with actionable error naming the required version and directing to update the app [rules-parsing] (format_version contract; reused by boot 1.15 and the P3 sync hook 3.8). — done: commit 9a89d3a; 7/7 (RED: module missing).
- [x] 1.9 `src/rules/types.ts` + `src/rules/parser.ts` — `RulesModel`/`NoteTypeDef`/`ValidationIssue` vocabulary; rules.md v1 parser (frontmatter `format_version` + fenced YAML blocks `note_types`/`lifecycle`/`conflict_policy_defaults`/`git`); malformed block ⇒ `RULES_PARSE_ERROR` naming the block and line area; no partial model served as valid [rules-parsing]. Table-driven tests over fixture vaults. — done: commit 5722cb0; 15 parser tests (mid-cycle fixes: YAML unquoted `1.0` parses as number → checkFormatVersion accepts string|number; fenced blocks unwrap their identity key).
- [x] 1.10 `src/rules/templates.ts` — `{{placeholder}}` renderer, pure string interpolation only (no logic/conditionals/loops/lookups); prose passes through unchanged; supplied keys leave no tokens [rules-parsing]. — done: commit 5767eb8; 6/6 (RED: module missing).
- [x] 1.11 `src/rules/validate.ts` — `validateNote(rules, note)`: required fields, field types, enums, patterns, naming pattern, folder; every failure names the violated rule (field/constraint/naming/folder) [rules-parsing]. One test per spec scenario. — done: commit ddfa813; 11 scenarios (RED: module missing).

Config module:

- [x] 1.12 `src/config/env.ts` (typed `SUPERMEMORY_*` access via `EnvSource` port) + `src/config/global-config.ts` (`config.json` under `SUPERMEMORY_CONFIG_DIR` | `~/.config/supermemory`; tests point the config dir at tmp — never the real HOME). — done: commit a10d471; 13/13 (RED: 2 files missing).
- [x] 1.13 `src/config/vault-config.ts` — `.memory/config.yml` loading + `resolveSyncTunables(env, vaultConfig, rules)` precedence env > config.yml `sync:` > rules `git:` block > built-ins (15 min / 45 s); timing knobs only — no hygiene gate overridable [sync-ladder] (tunables for P3; precedence tests land here). — done: commit 58467be; 10/10 (mid-cycle fix: `sync:` key with only comments parses as YAML null → normalized to {}).

Boot capability:

- [x] 1.14 `src/boot/sqlite-probe.ts` — `probeSqlite()`: in-memory DB, `CREATE VIRTUAL TABLE temp.sm_fts5_probe USING fts5(probe)`, capture `sqlite_version()`; failure ⇒ `SQLITE_FTS5_MISSING` with the exact OD-3 wording contract (asserted by test); the vitest smoke test doubles as the better-sqlite3 ESM-interop proof on Node LTS [boot-validation]. Land `docs/TROUBLESHOOTING.md` (rebuild fallback, custom-SQLite diagnosis). — done: commit af795d2; 2/2 incl. exact-wording contract + interop smoke (sqlite 3.53.4 / pkg 13.0.3).
- [x] 1.15 `src/boot/validate-boot.ts` — five ordered fail-fast checks: (1) existing directory, (2) git repo, (3) `.memory/rules.md` present, (4) not inside the app source repo, (5) `format_version` via 1.8; first failure aborts with a per-check `AppError` naming what failed + concrete next action (missing rules.md points at vault init); one negative fixture per check [boot-validation]. — done: commit 985332c; 7/7 incl. ordering test (ephemeral mini-vault inside the app root exercises check 4 through the ordered pipeline).

CLI (OD-1: commander + @inquirer/prompts):

- [x] 1.16 `src/cli/index.ts` — commander program: subcommand registration, `parseAsync`, `AppError` → stderr + exit codes, help/version. — done (this commit): buildProgram + runMain (exitOverride so parse errors never throw, AppError → code+message+hint on stderr, exit 1; help/version exit paths), shebang + direct-invoke guard; init/setup command registrations wired (stubs until 1.17/1.18). 6/6 (RED: module missing).
- [x] 1.17 `src/cli/commands/init.ts` — scaffold `.memory/` (rules.md v1 defaults incl. `git:` tunable seed, templates/, config.yml), default folders incl. top-level `conflicts/` (Obsidian-visible), vault `.gitignore` (`.memory/cache/`), `.gitattributes` (`merge=union` for logs/), then `validateBoot` + initial commit [boot-validation][rules-parsing]. — done: commit d1c2602; 8 tests incl. drift pin (scaffold bytes ≡ committed fixture) and boot-equivalence; guards: nonexistent path, non-git dir (hint git init), re-init refusal; exactly one `chore(supermemory): initialize vault` commit.
- [x] 1.18 `src/cli/commands/setup.ts` — `@inquirer/prompts` wizard: validated vault path, author identity, writes global config (`vaults.default`); is the remediation target of `No vault configured. Run: supermemory setup` [boot-validation]. — done: commit 44ca455; 3 tests via scripted PromptPort (config written, re-prompt until validateBoot passes, author defaults from vault git config); @inquirer/prompts bound at the console edge only.
- [x] 1.19 P1 phase gate — full vitest suite green on Node 22 LTS; `npm run typecheck` + `npm run build` clean; all rules-parsing and boot-validation spec scenarios asserted; guard check that no test writes to the real HOME; commit PR-1 work units. — done: `npm test` 120/120 across 21 files; typecheck clean; build clean (`dist/cli/index.js` with shebang preserved); hermeticity guards in `test/p1/gate.test.ts` (tmp-only config writes, vaults under os.tmpdir(), env restoration); apply-progress.md written.

## Phase 2 (P2) — SQLite index + MCP tool catalog (PR-2)

Index capability (`src/index` owns all SQL):

- [ ] 2.1 `src/index/db.ts` + `src/index/schema.ts` — open/migrate under `<vault>/.memory/cache/`; DDL for notes, properties, FTS5, links; cache present on disk and invisible to git status [index].
- [ ] 2.2 `src/index/upsert.ts` — incremental note upsert: saved/updated note immediately visible to `find` and backlink queries, no rebuild or restart [index].
- [ ] 2.3 `src/index/queries.ts` — property filters (`type`/`status`/`spec_id`/`tags`/`owner`/date-range), FTS5 free text, combined filters; backlinks over wikilinks + `spec_id` graph; the only SQL-calling module [index].
- [ ] 2.4 `src/index/rebuild.ts` — full rebuild from vault walk; deleting `.memory/cache/` loses nothing and reproduces identical query results (identity test) [index].
- [ ] 2.5 `src/index/maps.ts` — deterministic regeneration of `index/` markdown maps (sorted, stable formatting) — the input for P3's `chore(index)` commits [index].

Notes & save pipeline:

- [ ] 2.6 `src/notes/parse.ts` — gray-matter parse; deterministic id/title derivation (first `#` heading → `title` frontmatter → filename slug) shared by save, grammar, and index [tool-catalog].
- [ ] 2.7 `src/notes/linked-knowledge.ts` — spec hub Linked Knowledge section maintenance: appended on create, idempotent entries keyed by note id (repeated saves never duplicate) [tool-catalog].
- [ ] 2.8 `src/notes/save-pipeline.ts` — validate → render/merge → pull-before-write via injected `SyncPort` (null impl in P2) → write → `index.upsert` → `SyncPort.notifyWrite` → `{ path, id }` [tool-catalog].

MCP capability:

- [ ] 2.9 `src/mcp/catalog.ts` — pure `buildCatalog(rules)`: exactly six tools, no `project` parameter anywhere; `save` schema per note type (discriminated by type, `.strict()`, required/types/enums from the model); descriptions embed the team's prose verbatim; rules are the only input (rebuild-on-reload ready) [tool-catalog]. Contract test: catalog snapshot + no-`project` assertion.
- [ ] 2.10 `src/mcp/resources.ts` — `rules://current` resource (parsed rules + rendered templates); server instructions embed `templates/agent-instructions.md` when present [tool-catalog].
- [ ] 2.11 `src/mcp/tools/find.ts` — property + FTS5 search; results `{ id, title, status, path }` (+ type), default limit 20; in-memory-transport contract test (property filter + free-text scenarios) [tool-catalog][index].
- [ ] 2.12 `src/mcp/tools/read-with-context.ts` — content + frontmatter + backlinks (wikilinks and `spec_id`) + referenced specs' status/lifecycle + 5 most recent linked decisions/incidents; contract test on the spec-neighborhood scenario [tool-catalog].
- [ ] 2.13 `src/mcp/tools/save.ts` — thin: zod schema check → `validateNote` (violation returned verbatim) → save-pipeline; contract tests: non-conforming save names the violated rule; valid save maintains Linked Knowledge without duplicates [tool-catalog].
- [ ] 2.14 `src/mcp/tools/changes-since.ts` — ISO timestamp → git-log walk filtered to note-grammar commits, classified added/updated/status-changed/removed from deterministic headers (local header-parser here; unified into `src/sync/commit-message.ts` in 3.2) [tool-catalog].
- [ ] 2.15 `src/mcp/tools/sync.ts` + `src/mcp/tools/status.ts` — coded against the engine interface; P2 ships documented stubs ("engine lands in P3; `supermemory sync`/plain git still work"); no schema change when P3 wires the real engine [tool-catalog].
- [ ] 2.16 `src/mcp/server.ts` — boot per design §5.1: resolve vault (flag → `SUPERMEMORY_VAULT` → `vaults.default`; unresolvable ⇒ exact `No vault configured. Run: supermemory setup`) → `validateBoot` + probe → `loadRules` → `buildCatalog` → open/rebuild index → serve over stdio; stdout protocol-only, stderr logs; engine-state subscription point for `rules-refused`/`rules-reloaded` (P3) [tool-catalog][boot-validation].
- [ ] 2.17 `src/cli/commands/serve.ts` — `--vault` flag; never interactive; delegates to server boot [tool-catalog].
- [ ] 2.18 P2 phase gate — contract suite over `InMemoryTransport.createLinkedPair()`: exactly six tools listed; save-schema reflects declared required fields; rules-reload changes schemas without code change; cache-deletion rebuild identity; incremental upsert visibility; suite + typecheck + build green; commit PR-2 work units.

## Phase 3 (P3) — Sync engine + commit grammar + conflict ladder + secrets lint (PR-3)

- [ ] 3.1 `src/sync/secrets.ts` — pure v1 pattern set, high-precision only (AWS `AKIA…`, GitHub `ghp_/gho_/ghu_/ghs_/ghr_/github_pat_`, `glpat-`, Slack `xox[baprs]-`, Google `AIza…`, private key blocks, `sk-proj-`); no entropy heuristics; module-level constant; blocked ⇒ `SECRETS_BLOCKED` [sync-ladder].
- [ ] 3.2 `src/sync/commit-message.ts` — pure `deriveCommitMessage(op, type, frontmatter, prevFrontmatter?)` → header `note(<add|update|delete>): <type> "<title>" [<id>]` + meaningful-change suffix (`status: draft→active`) + trailers `Author:`/`Via:`/`Spec:` (interpret-trailers format); deletion derives from `git show HEAD:<path>`; byte-identical on repeat derivation; absorbs 2.14's header parser so derivation and classification share one grammar [sync-ladder].
- [ ] 3.3 `src/sync/git.ts` — typed thin simple-git wrapper: status/add/commit (human author + trailers)/pull --rebase --autostash/push (no force API exposed)/show/branch/rebase abort–continue.
- [ ] 3.4 `src/sync/lock.ts` — `SyncLock`/`LockHandle` + `PidfileLock` at `.memory/cache/supermemory-sync.lock` (`{ pid, owner, acquiredAt }`); live-pid check (ESRCH-safe), stale reclaim after rewrite, release deletes; `MemoryLockRegistry` fake tests: single-owner acquisition, second-actor refusal, stale reclaim, release-reacquire [sync-ladder].
- [ ] 3.5 `src/sync/ladder.ts` — pure classification from `RulesModel` + config (generated `index/` / union via `conflict_policy: union` default `logs/` / curated default) + routing: all-generated → `checkout --theirs` + continue + deterministic regeneration; all-union → union concatenation + normalization; any curated ⇒ whole rebase takes the curated path [sync-ladder].
- [ ] 3.6 `src/sync/conflict-note.ts` — write/read `conflicts/<date>-<note-id>.md` (frontmatter `status: open`, `note_path`, `snapshot_branch`, `detected_at`; body: both sides' summaries + `supermemory resolve` pointer); secrets lint before its `chore(conflict)` commit [sync-ladder].
- [ ] 3.7 `src/sync/state.ts` — `EngineState` snapshot: last successful sync, pending-write count, open conflicts, stale notes (lifecycle staleness vs `Clock.now()`), format version, push paused, lock owner [sync-ladder].
- [ ] 3.8 `src/sync/engine.ts` — `runCycle(trigger)` per design §4: acquire lock (held ⇒ ownership report) → pre-pull `format_version` guard on remote-tip rules (unsupported ⇒ skip pull, `rules-refused`) → per-write secrets lint + one commit per write event with derived message and human author (human working-tree changes via the same path) → `pull --rebase --autostash` → ladder on conflicts (curated ⇒ abort + snapshot branch `conflict/<date>-<note-id>` + conflict note + push paused) → union-log normalization (stable sort by timestamp, dedupe by entry id) → `chore(index): regenerate maps (<N> notes)` always separate → push (never force; capped exponential backoff on network failure via injected `Clock`, local writes intact, status keeps last success) → post-sync rules reload hook (refuse ⇒ halt commits/push; success ⇒ `rules-reloaded` with new model) [sync-ladder]. Tests: autostash survival, pull-before-write, skip-clean interval, backoff without loss.
- [ ] 3.9 `src/sync/scheduler.ts` — trailing-edge debounce (default 45 s) + interval fallback (default 15 min) built only on `TimerPort` + `Clock`; timers `.unref()`ed; triggers `runCycle` only (no git logic). Unit tests via a `ManualTimerPort` queue; production wiring proven under `vi.useFakeTimers()` + `advanceTimersByTimeAsync` [sync-ladder].
- [ ] 3.10 `src/sync/resolve.ts` — guided flow: list open conflicts from conflict notes; materialize `<note>.local.md` + `<note>.remote.md` (extracted from the snapshot branch) side by side; prompt merge into the real path; finalize: commit `note(update): … (conflict resolved)`, push, flip conflict note to `status: resolved`; snapshot branch retained [sync-ladder].
- [ ] 3.11 `src/cli/commands/sync.ts` — single `runCycle('manual')`, outcome report, no scheduler start [sync-ladder].
- [ ] 3.12 `src/cli/commands/resolve.ts` — CLI entry for 3.10 [sync-ladder].
- [ ] 3.13 Wiring — `src/cli/commands/serve.ts` + `src/mcp/server.ts` inject the real engine + scheduler; `sync`/`status` tools switch from stubs to the engine (no schema change); `src/notes/save-pipeline.ts` receives the real `SyncPort` (pull-before-write + notifyWrite) [sync-ladder][tool-catalog].
- [ ] 3.14 P3 phase gate — headline never-delete test (divergent clones ⇒ rebase aborted with local state intact, remote version recoverable from the snapshot branch, conflict note visible in vault, `resolve` completes and `status` clears); secrets blocked on every trigger; lock single-owner/stale in a server-vs-CLI scenario; full hermetic M1 loop (`createTestVault` + bare remote → boot → save → debounce → cycle → find) green; suite + typecheck + build green; commit PR-3 work units.

---

## Review Workload Forecast — per-phase detail

| Phase | Contents | Est. lines (code + tests) | vs 400-line budget |
|---|---|---|---|
| Phase 0 | docs/RFC.md + openspec artifacts + .gitignore + README note (docs-only, no code) | ~2,500–3,000 | ~7× (docs-only; low review risk) |
| Phase 1 (P1) | scaffold ~180 · util/config/rules/boot/cli ~850 · tests ~750 · TROUBLESHOOTING/config ~90 | ~1,850 | ~4.6× |
| Phase 2 (P2) | index/notes/mcp/serve ~950 · tests ~850 | ~1,800 | ~4.5× |
| Phase 3 (P3) | sync engine + grammar/ladder/lock/secrets/resolve ~1,000 · cli/wiring ~200 · tests ~1,000 | ~2,200 | ~5.5× |

- Every implementation phase independently exceeds the 400-line review budget — this is structural (five capabilities, hermetic test infrastructure, and the sync engine cannot be thinned without dropping spec coverage).
- **Chained PRs recommended: Yes** — suggested split PR 1 (Phase 0 + P1) → PR 2 (P2) → PR 3 (P3); each phase has a clear start, finish, verification (phase-gate task), and rollback boundary (revert-PR on a greenfield repo).
- **Decision needed before apply: Yes** — delivery strategy is `ask-on-risk`: the parent pauses and asks before chaining; no chain strategy (`stacked-to-main` / `feature-branch-chain`) and no `size:exception` are selected in this artifact.
