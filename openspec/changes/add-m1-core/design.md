# Design — add-m1-core (M1: Core, dogfood-ready)

Phase: design · Status: complete
Inputs: `proposal.md` (this change), five capability specs (`specs/*/spec.md`), `docs/RFC.md` v1.2 §3–§8, `explore.md`, `openspec/config.yaml` design rules.
Scope guard: single-vault M1 only. No `project` parameter, no multi-vault, no `manual`/`pr` sync modes, no vault registration, no elicitation. Where the RFC describes M2/M3 surfaces, this design names them only as *excluded*.

---

## 1. Module layout and conventions

This repository is greenfield (no `package.json`, no source, no tests). This section is the convention baseline every later phase inherits; deviations require a design-note update.

### 1.1 Package shape

- **Single npm package at the repo root** named `supermemory`, published as a CLI+server (`npx supermemory …`). No monorepo, no workspaces in M1 — one product, one binary surface.
- **`"type": "module"` (ESM) with NodeNext resolution.** Rationale: the MCP SDK and modern tooling are ESM-first; NodeNext is the only resolution mode that correctly models ESM+CJS interop (we depend on CJS packages: `better-sqlite3`, `gray-matter`).
- **`engines`: `"node": ">=22.0.0"`.** Rationale: 22.x is the active LTS line in use by the maintainers; `better-sqlite3` prebuilds and the installed toolchain match it. The CI/test matrix runs Node 22 LTS only (no legacy-matrix cost in M1). The floor may be bumped by a deliberate PR when the LTS line moves.
- **`bin`**: `{ "supermemory": "dist/cli/index.js" }` with a `#!/usr/bin/env node` shebang in `src/cli/index.ts`.
- **No `exports` map in M1.** The package ships a binary, not a library API; adding `exports` later is additive and non-breaking. Rationale: freezing a public programmatic API before the internals stabilize would be premature.
- **`files`: `["dist"]`** — tests and fixtures never ship.
- **Dependencies** (version *strategy* in §2.2/§4.2; exact numbers resolved by the P1 dependency task — this design phase has no network access and must not invent versions): `commander`, `@inquirer/prompts`, `@modelcontextprotocol/sdk` (exact pin), `zod` (single-major tilde pin), `simple-git`, `gray-matter`, `better-sqlite3` (minor-range pin), `yaml`.
- **Dev dependencies**: `typescript`, `vitest`, `@types/node`, `@types/better-sqlite3`, `tsx` (dev runner). `commander` ships its own types; no `@types/commander`.

### 1.2 Directory tree

```text
.
├── package.json
├── tsconfig.json                  # base config (src + test)
├── tsconfig.build.json            # src → dist (used by npm run build)
├── vitest.config.ts
├── .env.example                   # documents SUPERMEMORY_* knobs
├── .gitignore                     # repo-level (phase-0 baseline + D2)
├── README.md
├── docs/
│   ├── RFC.md
│   └── TROUBLESHOOTING.md         # P1: better-sqlite3 rebuild fallback (OD-3)
├── openspec/
├── src/
│   ├── cli/                       # composition root
│   │   ├── index.ts               # bin entry; builds the commander program
│   │   └── commands/
│   │       ├── init.ts            # P1
│   │       ├── setup.ts           # P1  (interactive; @inquirer/prompts)
│   │       ├── serve.ts           # P2  (boots MCP server)
│   │       ├── sync.ts            # P3
│   │       └── resolve.ts         # P3  (guided conflict resolution)
│   ├── config/                    # P1
│   │   ├── env.ts                 # typed SUPERMEMORY_* access (EnvSource port)
│   │   ├── global-config.ts       # config.json under SUPERMEMORY_CONFIG_DIR | ~/.config/supermemory
│   │   └── vault-config.ts        # .memory/config.yml + precedence resolution (§5.4)
│   ├── boot/                      # P1 — boot-validation capability
│   │   ├── validate-boot.ts       # the five vault checks, ordered, fail-fast
│   │   └── sqlite-probe.ts        # FTS5 capability probe (OD-3)
│   ├── rules/                     # P1 — rules-parsing capability
│   │   ├── types.ts               # RulesModel (shared vocabulary for all modules)
│   │   ├── parser.ts              # rules.md v1 → RulesModel (fenced YAML blocks)
│   │   ├── templates.ts           # {{placeholder}} renderer — pure string interpolation
│   │   ├── validate.ts            # validateNote(rules, note) — pure
│   │   └── version.ts             # format_version contract (shared by boot + sync reload)
│   ├── notes/                     # P2 — note I/O + the save pipeline
│   │   ├── parse.ts               # gray-matter parse; deterministic id/title derivation
│   │   ├── linked-knowledge.ts    # spec hub section maintenance (append, dedupe)
│   │   └── save-pipeline.ts       # validate → render → pull-before-write → write → upsert → notify
│   ├── index/                     # P2 — index capability (owns everything SQLite)
│   │   ├── db.ts                  # open/migrate; single sqlite entry point
│   │   ├── schema.ts              # DDL: notes, properties, FTS5, links
│   │   ├── upsert.ts              # incremental note upsert (spec: update on write)
│   │   ├── queries.ts             # property filters / FTS / backlinks — the only SQL callers
│   │   ├── rebuild.ts             # full rebuild from vault walk
│   │   └── maps.ts                # deterministic regeneration of index/ markdown maps
│   ├── mcp/                       # P2 — tool-catalog capability
│   │   ├── server.ts              # boot → catalog → engine → stdio serve
│   │   ├── catalog.ts             # six tools + zod schemas generated from RulesModel
│   │   ├── resources.ts           # rules://current resource
│   │   └── tools/
│   │       ├── find.ts
│   │       ├── read-with-context.ts
│   │       ├── save.ts            # thin: schema + calls notes/save-pipeline
│   │       ├── changes-since.ts
│   │       ├── sync.ts            # P2 stub → P3 wired to engine
│   │       └── status.ts          # P2 stub → P3 wired to engine
│   ├── sync/                      # P3 — sync-ladder capability
│   │   ├── engine.ts              # one sync cycle; shared CLI+MCP; post-sync rules hook
│   │   ├── scheduler.ts           # debounce + interval over injectable timers
│   │   ├── git.ts                 # simple-git wrapper (typed, thin)
│   │   ├── commit-message.ts      # pure: op + frontmatter → header + trailers
│   │   ├── ladder.ts              # conflict classification + per-category strategy
│   │   ├── conflict-note.ts       # write/read conflict notes in conflicts/
│   │   ├── resolve.ts             # guided resolve flow
│   │   ├── lock.ts                # Lock interface + PidfileLock
│   │   ├── secrets.ts             # lint pattern set — pure
│   │   └── state.ts               # engine status snapshot (in-memory; durable state = vault + git)
│   └── util/
│       ├── errors.ts              # AppError { code, message, hint } (see §1.5)
│       ├── clock.ts               # Clock + Scheduler ports (OD-4)
│       ├── log.ts                 # stderr-only logger, SUPERMEMORY_LOG_LEVEL
│       └── paths.ts               # .memory layout helpers
└── test/
    ├── helpers/
    │   ├── create-test-vault.ts   # fixture → mkdtemp(os.tmpdir()) + git init (§1.6)
    │   ├── create-remote.ts       # bare repo + clones + divergence helpers
    │   └── env.ts                 # SUPERMEMORY_* sandbox helper
    ├── fixtures/
    │   └── vault/                 # committed template assets (rules.md, templates/, config.yml) — no nested .git
    └── <module>/*.test.ts         # mirrors src/ tree
```

Directories land with their phases (§9): `src/cli`, `src/rules`, `src/config`, `src/boot`, `src/util` in P1; `src/notes`, `src/index`, `src/mcp` in P2; `src/sync` in P3.

### 1.3 Dependency rules (the module graph)

Dependencies point strictly downward; no cycles:

```text
cli ──────────────► config, boot, rules, notes, index, mcp, sync   (composition root)
mcp ──────────────► rules, notes, index, sync, config, util        (thin transport/schema layer)
sync ─────────────► rules, config, notes(parse), git wrapper, util
notes ────────────► rules, config, util        (+ SyncPort injected — see below)
index ────────────► notes(parse), rules, util
boot ─────────────► config, rules(version), util
config, rules ────► util only                  (leaf, pure where possible)
```

**One deliberate inversion:** `notes/save-pipeline` needs pull-before-write and write-notification (owned by `sync`), while `sync` needs `notes/parse` for commit-message derivation — a direct `notes → sync` import would cycle. Resolution: `save-pipeline` accepts an injected **`SyncPort`** (`{ pullLatest(notePath?), notifyWrite(event) }`) supplied by the composition root (`cli/serve.ts`). In P2 (no engine yet) a null port is injected; in P3 the real engine adapter is. Rationale: keeps the graph acyclic, makes the save pipeline unit-testable without git, and makes the P2→P3 seam exactly one injection point.

### 1.4 tsconfig and TypeScript conventions

`tsconfig.json` (base) / `tsconfig.build.json` (build):

- `"module": "nodenext"`, `"moduleResolution": "nodenext"` — mandatory for the ESM+CJS mix; relative imports **always use explicit `.js` extensions** (NodeNext requirement; enforced by review convention).
- `"target": "ES2023"`, `"lib": ["ES2023"]` — fully supported by Node 22.
- `"strict": true`, `"noUncheckedIndexedAccess": true`, `"verbatimModuleSyntax": true` — NodeNext-safe type-only imports; catches the CJS-default-import mistakes the P1 smoke test also guards (OD-3).
- `"outDir": "dist"`, `"rootDir": "src"` (build config), `"declaration": true`, `"sourceMap": true`.
- `"skipLibCheck": true` — isolates us from `.d.ts` drift in native/optional dep chains.
- Base config includes `src` **and** `test` so `npm run typecheck` covers tests; the build config includes only `src`.
- **Named exports only** (no default exports). Rationale: greppable, refactor-safe, uniform.
- **File names kebab-case** (`commit-message.ts`); exported symbols PascalCase.

### 1.5 Error convention (supports every "actionable error" spec requirement)

`src/util/errors.ts` defines:

```text
AppError { code: string; message: string; hint?: string }
```

with stable codes per module: `RULES_PARSE_ERROR` (names the fenced block + line area), `FORMAT_VERSION_UNSUPPORTED`, `BOOT_VALIDATION_FAILED` (one per check, each with a concrete next action), `SQLITE_FTS5_MISSING`, `SECRETS_BLOCKED`, `LOCK_HELD`, `CONFLICT_CURATED`, `NO_VAULT_CONFIGURED`. Spec-mandated message: `No vault configured. Run: supermemory setup` maps to `NO_VAULT_CONFIGURED`. Rationale: the specs require located, actionable failures across four capabilities; a single error shape lets the CLI, the MCP layer, and tests assert uniformly instead of string-matching ad hoc.

### 1.6 Runtime conventions

- **stdout is reserved for the MCP protocol in `serve`.** All logs go to stderr (`util/log.ts`), level via `SUPERMEMORY_LOG_LEVEL`. Rationale: a stray console.log on stdout corrupts the stdio transport — this is the classic MCP-server failure mode.
- Env is read **only** at the edges (`config/env.ts`, CLI arg parsing). Core modules take explicit parameters; tests never mutate `process.env` to steer logic (see §1.8).
- The vault is never mutated outside `.memory/cache/` for derived state; durable engine state is the vault itself (conflict notes) and git (snapshot branches). Rationale: invariant 1–2 (vault is source of truth; deleting cache loses nothing).

### 1.7 vitest setup (D3)

- `vitest.config.ts`: node environment (default), `testMatch: ["test/**/*.test.ts"]`, no globals — tests import `{ describe, it, expect, vi }` explicitly. Rationale: explicit imports keep files readable outside an editor's vitest integration and avoid global-type coupling.
- Scripts: `test: "vitest run"`, `test:watch: "vitest"`, `typecheck: "tsc --noEmit"`, `build: "tsc -p tsconfig.build.json"`, `dev: "tsx src/cli/index.ts"`.
- The P1 task that lands vitest also flips `strict_tdd: true` and backfills `apply.test_command: "vitest run"`, `verify.test_command: "vitest run"`, `verify.build_command: "npm run build"` in `openspec/config.yaml` (decision D3).
- Fake timers: `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(...)` for scheduler tests (OD-4). Per-file usage only; vitest isolates files into workers so timer globals never leak across suites.

### 1.8 Test fixture strategy (hermetic, no network, no HOME writes)

- **`createTestVault()`** (`test/helpers/create-test-vault.ts`): copies `test/fixtures/vault/` (committed template assets — rules.md, templates/, config.yml, .gitattributes, folder skeleton; **never a nested `.git`**) into `mkdtemp(os.tmpdir())`, runs `git init` + local config (`user.name/email`, `commit.gpgsign false`, fixed `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` hooks where determinism matters), optionally seeds notes, returns `{ root, paths, cleanup }`. Registered cleanup closes DB handles before deleting the tree.
- **`createRemote()`**: `git init --bare` in a tmp dir, plus clones wired to it over local paths — the hermetic stand-in for GitHub. Conflict tests use a helper that makes two divergent clones (local ahead + remote ahead on the same note region) so the ladder's abort/snapshot/note path is exercised without any network.
- **Env override hooks**: `test/helpers/env.ts` provides `withTestEnv({ configDir, vault }, fn)` which sets/restores `SUPERMEMORY_CONFIG_DIR` and `SUPERMEMORY_VAULT` around a test. Only composition-level resolution reads these (launch resolution), so most unit tests inject paths directly instead.
- **Determinism**: fixed dates for git commits and clock injection (OD-4) make `commit-message` and `changes_since` assertions byte-stable.
- Tests never read the real `~/.config/supermemory` — global-config tests point `SUPERMEMORY_CONFIG_DIR` at a tmp dir. Runtime writes outside the repo happen only when a human dogfoods `setup`/`serve`, never under `vitest`.

---

## 2. Open decisions — resolution (one section per decision, each with rationale)

### OD-1 — CLI library: **commander** (+ `@inquirer/prompts` for the wizard)

**Decision.** Argument/command parsing with `commander`; interactive prompts in `setup` with `@inquirer/prompts`.

**Rationale.**
- The M1 command surface is small and fixed — `init`, `setup`, `serve --vault`, `sync`, `resolve` — with one option flag. It needs subcommands, typed args, help text, version; nothing more. `commander` covers exactly this with **zero runtime dependencies** and first-party TypeScript types.
- Alternatives rejected: `oclif` (plugin framework and multi-package ergonomics aimed at large CLI suites — structural overkill for five commands); `yargs` (powerful but heavy, weaker TS story, historical ESM friction); `clipanion` (class-based API shines for yarn-scale CLIs, niche for this size); `cac` (fine, but smaller governance/maintenance surface than commander).
- Parsing and prompting are orthogonal: the `setup` wizard is prompt-driven with a validated path (`@inquirer/prompts` — maintained, no native deps, good TS types), so the parser library stays a pure parser.
- Commander's `program.parseAsync` model composes cleanly with fail-fast `AppError` handling in the bin entry.

### OD-2 — MCP SDK + zod pinning strategy (with the P1 install-time verification step)

**Decision.**
1. `@modelcontextprotocol/sdk`: **exact pin** (`"1.x.y"`, no range) — resolved by the P1 dependency task, not guessed here.
2. `zod`: **single-major, tilde-minor pin**. Major chosen by rule: *install the highest zod major that satisfies the SDK's declared peer range; if both 3 and 4 satisfy, choose 3.*
3. `better-sqlite3`: minor-range pin (`"^12.x"` style at whatever major is current) constrained by "prebuilds exist for darwin-arm64 + linux-x64 on Node 22"; all other deps: caret pins; `simple-git`/`gray-matter`/`yaml` at current stable majors.
4. The lockfile is committed; upgrades are deliberate PRs.

**P1 install-time verification step** (the tasks phase must include this as a task; it cannot run in design because there is no install surface yet):
1. `npm view @modelcontextprotocol/sdk@latest version peerDependencies --json` → record the zod peer range.
2. Apply the OD-2 rule → pick zod major (expected: peer range today still admits 3.x; if it admits only 4, take 4 — the rule is mechanical either way).
3. `npm install --dry-run` (default peer resolution, no `--legacy-peer-deps`) → must resolve with zero peer conflicts; any conflict aborts the task for a design note, not a workaround flag.
4. Record the resolved trio (SDK, zod, better-sqlite3) in the task notes so reviewers see the decision trail; the lockfile is the enforcement artifact.

**Rationale.**
- RFC §11 names MCP spec churn as a standing risk: an exact SDK pin + lockfile makes `npx supermemory@latest` reproducible and turns SDK upgrades into reviewable events rather than ambient drift.
- zod: the tool schemas are *generated from team rules* and rendered to JSON Schema through the SDK — behavior drift inside zod (3→4 differed in error customization and some inference details) would silently change agent-facing validation. One major, tilde-minor, is the stability/patch balance; preferring 3 on ties keeps the conservative default while the ecosystem settles.
- better-sqlite3: minor range (not exact) because prebuild availability across Node patch releases is exactly what minor releases track; exact-pinning a native module creates churn without safety.
- Installing the SDK in P1 (before any MCP code exists in P2) is deliberate: it front-loads the riskiest interop check (OD-2 + zod + ESM) into the scaffold phase where a failure is a one-file fix, per proposal risk 3.

### OD-3 — better-sqlite3 FTS5 probe mechanics

**Decision.** `src/boot/sqlite-probe.ts` exports `probeSqlite(): Promise<SqliteProbeResult>`:

1. Open `new Database(":memory:")` (importing `better-sqlite3` via NodeNext default-import interop — this doubles as the **P1 ESM-interop smoke test**).
2. Run `CREATE VIRTUAL TABLE temp.sm_fts5_probe USING fts5(probe)` in a try/catch; capture `SELECT sqlite_version()`.
3. Close the DB. On failure throw `AppError{ code: "SQLITE_FTS5_MISSING", … }` with the message below.

**Boot placement and ordering.** Boot validation runs the five vault checks **first** (cheap, most-likely-actionable), then the FTS5 probe immediately before the index is opened/created. Rationale: an invalid vault path is the more common first-run failure; it should not be masked behind a native-module error, and conversely a valid vault with a broken SQLite is precisely the case the probe exists for. (The probe runs on every `serve` boot and on every `init`/`setup` that will exercise the index; a P1 vitest test asserts the probe passes on the CI Node-LTS matrix — that test *is* the better-sqlite3 interop smoke test.)

**Failure message (wording contract, asserted by a test):**

```text
supermemory: SQLite on this machine was built without FTS5 (better-sqlite3 <pkg-version>, SQLite <sqlite-version>).
The vault search index requires FTS5 full-text search; `find` cannot work without it.

Fix — rebuild the native module from source:
  npm rebuild better-sqlite3 --build-from-source
(requires a C compiler + Python toolchain; see docs/TROUBLESHOOTING.md)

Prebuilt binaries shipped with better-sqlite3 normally include FTS5 — a missing FTS5
usually means a custom SQLite build was picked up. See docs/TROUBLESHOOTING.md#fts5.
```

**Fallback documentation.** `docs/TROUBLESHOOTING.md` (P1) covers: what FTS5 is and why the index needs it; the `npm rebuild better-sqlite3 --build-from-source` fallback with toolchain prerequisites per platform; the "custom SQLite picked up" diagnosis path; and how the boot probe reports it. Rationale: the boot-validation spec requires the error to "describe the rebuild fallback" — pointing at a shipped doc keeps the error short and the remediation complete.

**Ownership note:** the probe lives in `src/boot` (P1), *not* `src/index` (P2) — the index module owns DDL/queries once it exists, but the probe must exist a phase earlier and has no index dependencies. This is the one intentional place `boot` touches sqlite directly.

### OD-4 — Injectable clock/lock seams

**Clock/timers.** `src/util/clock.ts` defines the ports:

```text
Clock        { now(): Date }
TimerPort    { set(delayMs, fn): Cancel; /* interval variant */ every(intervalMs, fn): Cancel }
```

Production impl wraps global `setTimeout`/`setInterval` with **`.unref()`** (a pending debounce must never keep a CLI process alive; the server lives regardless). `src/sync/scheduler.ts` builds debounce + interval *only* on `TimerPort` + `Clock`; it never touches globals directly.

**Test strategy — two layers:**
- Unit (scheduler/engine): inject a `ManualTimerPort` (test helper: queue of scheduled callbacks with `advance(ms)`) — deterministic, no global mutation, works even in suites that can't use fake timers.
- Integration-ish (full engine wiring): run the *production* timer impl under `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(45_000)` — proves the real wiring (e.g. "debounced push follows a write" scenario) without waiting wall-clock time.
Rationale: fake timers alone would be enough, but the manual port keeps the scheduler's own tests race-free and makes the debounce-window semantics explicit as a queue; the fake-timer layer then verifies the production adapter. `Clock.now()` backs every timestamp the engine records (status, backoff, conflict note dates) so time-dependent tests never sleep.

**Lock.** `src/sync/lock.ts`:

```text
SyncLock      { acquire(owner: LockOwner): Promise<LockHandle | null> }   // null = held by a live other actor
LockHandle    { owner: LockOwner; pid: number; release(): Promise<void> }
```

Production `PidfileLock` writes `{ pid, owner, acquiredAt }` to `.memory/cache/supermemory-sync.lock`; on read it treats a pidfile as held only if the pid is alive (`process.kill(pid, 0)` — wrapped for ESRCH), and **reclaims stale locks** (dead pid) after rewriting. Release deletes the file. Tests use a `MemoryLockRegistry` fake for: single-owner acquisition, second-actor refusal, stale-pid reclaim, release-reacquire.

**Second-actor behavior in M1: report, don't delegate.** When the server owns the lock and the CLI requests it, the CLI prints an ownership report (owner, pid, actionable text: use the `sync` MCP tool or wait for the owning process). The spec allows "delegates **or** reports"; delegation requires an IPC/notify channel that no M1 spec defines — inventing one is out of scope. Delegation remains a possible M2 refinement; the `LockOwner` enum (`'server' | 'cli'`) keeps the door open.

---

## 3. Cross-capability ownership boundaries

Boundaries exist so spec scenarios have exactly one place to fail and one test surface to observe (per the spec-phase risk notes):

| Concern | Owned by | Observed through (spec surface) | Must NOT appear in |
|---|---|---|---|
| Note validation (fields, types, enums, patterns, naming, folder) | `src/rules/validate.ts` (pure) | `save` tool rejections naming the violated rule | `src/index`, `src/sync`, `src/mcp` (all call it, none re-implement it) |
| Index content & queries (properties, FTS, link graph, rebuild, `index/` maps) | `src/index` | `find`, `read_with_context`, cache-deletion rebuild test | any other module issuing SQL |
| format_version contract | `src/rules/version.ts` (`checkFormatVersion`) | boot validation; sync-time reload hook (below) | duplicated checks elsewhere |
| Commit grammar & trailers | `src/sync/commit-message.ts` (pure) | `git log` assertions in sync tests | engine inline string-building |
| Sync tunables resolution | `src/config/vault-config.ts` | scheduler config tests | scheduler reading files itself |
| Secrets patterns | `src/sync/secrets.ts` (pure) | lint-blocks-commit tests on every trigger | engine inline regexes |

### 3.1 format_version sync-time re-check — where the hook lives

The *check* is owned by `src/rules/version.ts` and is the same function boot uses (rules-parsing spec: "enforced whenever rules are loaded"). The *hook* lives in **`src/sync/engine.ts` as a post-sync step (P3)**:

1. **Pre-pull guard:** before `pull --rebase`, the engine reads the incoming `.memory/rules.md` from the remote tip (`git show <remote-ref>:.memory/rules.md`) and runs `checkFormatVersion` on its frontmatter. If unsupported → **skip the pull entirely**, enter `rules-refused` state, report the actionable error (`vault requires format 2.x — update supermemory`). The team's new rules stay intact on the remote; the local vault keeps operating on 1.x until the app is updated. Rationale: never merge rules the build cannot interpret — refusing earlier is strictly safer than rebase-applying then refusing.
2. **Post-sync reload hook:** after any cycle whose applied changes include `.memory/rules.md` (or after a human edits it locally — detected via the cycle's diff), the engine calls `rulesEngine.reload()` (loadRules + checkFormatVersion + re-resolve tunables). On `FORMAT_VERSION_UNSUPPORTED`: engine halts commits/push and sets `rules-refused`. On success: engine emits `rules-reloaded` with the new `RulesModel`.
3. **Server reaction:** `src/mcp/server.ts` subscribes to engine state. `rules-refused` ⇒ every tool call returns the same actionable version error (matches boot semantics: nothing operates against mismatched rules); `rules-reloaded` ⇒ the catalog is rebuilt from the new model (tool-catalog spec: "editing rules changes behavior without redeploy"). This is exactly the spec scenario "Format check re-runs when a sync changes rules".

### 3.2 Config precedence for `sync_interval_minutes` / `debounce_seconds`

Resolution order (highest wins), implemented as the pure function `resolveSyncTunables(env, vaultConfig, rules)` in `src/config/vault-config.ts`:

1. **Env overrides** — `SUPERMEMORY_SYNC_INTERVAL_MINUTES`, `SUPERMEMORY_DEBOUNCE_SECONDS` (documented in `.env.example`; the same hooks tests use). Machine/personal + hermetic-test surface.
2. **`.memory/config.yml`** (`sync:` section) — the committed *team policy* file (RFC §8: "Team-level sync policy lives in the vault's committed `.memory/config.yml`").
3. **`rules.md` `git:` block** — defaults shipped by `init` (RFC §4.2 shows `sync_interval_minutes: 15`, `debounce_seconds: 45` there).
4. **Built-in constants** — 15 min / 45 s (the RFC's "~45s"/"15 min" defaults).

**Rationale.** `config.yml` outranks the rules git block because it is the dedicated policy surface — tuning sync cadence should not require editing the ontology file every member reads; the rules block is the *default seed* that `init` writes into both files so they agree at birth (divergence is resolved by precedence, and `config.yml` carries a comment saying so). Env outranks both per RFC §8's "local `.env` is for machine and personal preferences only" — a slow-network laptop or a fast test loop can tune timing without touching committed files. **Hard limit:** env/config can only adjust timing knobs — they cannot disable secrets lint, validation, or any hygiene gate (non-negotiable gates are not part of the precedence chain). M1 reads real environment variables only; the `~/.config/supermemory/.env` loader is deferred to M2 together with the sync-mode strictest-wins machinery it exists for.

---

## 4. Sync engine design (`src/sync`, P3)

### 4.1 Engine and the one sync cycle

`engine.ts` holds: the `LockHandle`, current tunables, last-successful-sync timestamp, conflict state, and the write journal (system writes since last commit). One code path serves CLI `sync`, the MCP `sync` tool, debounce, and interval (invariant 4).

`runCycle(trigger: 'debounce' | 'interval' | 'manual' | 'tool')`:

1. **Lock**: acquire; if held by a live other actor → return the ownership report (OD-4); two engines never race.
2. **Pre-pull guard** on incoming rules format_version (§3.1).
3. **Commit pending writes** — one commit per write event, journal order: `secrets.lint(fileContent)` → blocked ⇒ report, keep pending, never push; else `git.commit` with `commit-message.derive(...)` and **human author + trailers** (§4.3). Human-made working-tree changes (edited outside the system) are detected via git status and committed through the same derivation path.
4. **Pull-rebase**: `git pull --rebase --autostash` (spec: uncommitted residue survives via autostash). Conflicts ⇒ conflict ladder (§4.4).
5. **Union-log normalization pass** (post-rebase): for each union-merged log, stable-sort entries by timestamp, dedupe by entry id; commit `chore(sync): normalize session logs` if it changed anything.
6. **Regenerate `index/` maps** (`src/index/maps.ts`, deterministic output — sorted, stable formatting): if content changed, commit `chore(index): regenerate maps (<N> notes)` — always separate from note commits (spec).
7. **Push** — never with force, ever (spec). `rules-refused` or unresolved curated conflict ⇒ push is paused; reads/writes continue.
8. **Network failure**: retry with capped exponential backoff (via injected `Clock` — deterministic tests); local commits/pending writes intact; `status` keeps reporting last successful sync (spec).
9. **Post-sync rules hook** (§3.1) → reload or refuse; update engine state.

**Skip-clean (interval):** if the tree is clean and local is not ahead after the pull, the cycle returns to idle with zero commits — no empty commits, no cron noise (spec scenario).

### 4.2 Scheduler (`scheduler.ts`)

- **Debounce** (default 45 s, tunables via §3.2): every write notification resets the trailing-edge timer; firing calls `runCycle('debounce')`.
- **Interval fallback** (default 15 min): `every(intervalMs, () => runCycle('interval'))`.
- Built only on `TimerPort` + `Clock` (OD-4); timers are `.unref()`d; scheduler owns no git logic — it only triggers the engine. In the server, the scheduler runs for the process lifetime; the CLI `sync` runs a single `runCycle('manual')` without starting a scheduler.

### 4.3 Commit grammar (`commit-message.ts`, pure)

`deriveCommitMessage(op, noteType, frontmatter, prevFrontmatter?) → { header, trailers }`:

- Header: `note(<add|update|delete>): <type> "<title>" [<id>]`
  - `title`: first `# heading` of the body, else a `title` frontmatter field, else the filename slug — deterministic priority, resolved by `notes/parse.ts` so parse, grammar, and index agree.
  - `id`: the type's id field — resolution rule: explicit `id_field` on the note type if declared, else `<type>_id` when present in frontmatter (spec→`spec_id`, decision→`decision_id`, …), else omitted together with the trailing `[...]` (e.g. session logs).
  - Update suffix for the meaningful change: when a lifecycle-relevant frontmatter field changed (canonical: `status`), append ` (status: draft→active)`; body-only edits produce no suffix. Deletion derives id/title from the HEAD version of the file (`git show HEAD:<path>`).
- **Trailers** (final paragraph, git `interpret-trailers` format, asserted via `git log --format=%(trailers)`): `Author:` (human display name), `Via:` (agent/client provenance — from the MCP client context or `cli`), `Spec:` (the linked `spec_id`, when present).
- **Author vs committer**: commit author is always the human identity (`.memory/local.json` → global config `author` → inherited git config, first match wins); the committer identity is left to the machine. `git blame` shows people (spec).
- **Determinism**: same inputs ⇒ byte-identical message; pure function, property-tested by deriving twice and by the spec's byte-identical scenario. `git log --grep=<id>` is the query interface `changes_since` builds on (§6.4).

### 4.4 Conflict ladder (`ladder.ts` + `conflict-note.ts`)

**Classification** (pure, from `RulesModel` + config): each conflicted path → `generated` (under a `git.generated_paths` entry, default `index/`), `union` (note type with `conflict_policy: union`, default `logs/`), or `curated` (everything else — default policies from `conflict_policy_defaults`).

**Routing:**
- **All conflicts generated**: `git checkout --theirs <paths>` (either side is fine), `git add`, `git rebase --continue`, then deterministic regeneration in step 6 above. No human involvement (spec scenario).
- **All conflicts union**: `.gitattributes merge=union` concatenates during the rebase; the post-rebase normalization pass (step 5) sorts and dedupes. If union itself still conflicts (marker-level), the engine resolves by taking both regions (concatenation) — the normalizer makes the result canonical.
- **Any curated conflict** (including mixed curated+auto): treat the whole rebase as curated — abort is the never-lose path, and auto-resolving half a conflicted rebase while aborting the other half has no clean git semantics. Decision rationale: safety ordering — automatic resolution only when *every* conflict is auto-resolvable.

**Curated path (the headline flow):**
1. `git rebase --abort` — local state intact, nothing lost.
2. Snapshot the incoming side: branch `conflict/<YYYYMMDD-HHMM>-<note-id>` created at the remote tip; the remote version of the note is recoverable from it (spec: "snapshot the incoming side on a branch named `conflict/<date>-<note-id>`").
3. Write a **conflict note into the vault**: `conflicts/<date>-<note-id>.md` (frontmatter: `status: open`, `note_path`, `snapshot_branch`, `detected_at`; body: both sides' summaries + "run `supermemory resolve`"). `conflicts/` is scaffolded by `init` (P1) — a top-level folder, not under `.memory/`, because it must be **visible in Obsidian**, which hides dotfolders (RFC: "visible in Obsidian, no git knowledge required"). The conflict note is committed locally (lint runs on it) as `chore(conflict): record divergent edits for <note-id>`.
4. Engine state: push paused; vault reads and writes continue locally; `status` reports the unresolved conflict.
5. **`supermemory resolve`**: lists open conflicts (from conflict notes); materializes both sides side by side (`<note>.local.md` from the working tree, `<note>.remote.md` extracted from the snapshot branch, both next to the conflict note); prompts the human to merge into the real note path and confirm; then finalizes: commit the merged note (`note(update): … (conflict resolved)` via the same derivation), push, flip the conflict note to `status: resolved`. The snapshot branch is **retained** after resolution (audit trail; deletion is a destructive act with no M1 need). Git experts may resolve manually — everything is ordinary git.

**Never silently delete** (spec, invariant): local version remains in the vault; remote version recoverable from the snapshot branch; the headline test asserts both after a divergent-edit cycle.

### 4.5 Lock (single owner) — `lock.ts`

Pidfile lock per §OD-4, at `.memory/cache/supermemory-sync.lock`. The server acquires it at `serve` boot and holds it for the process lifetime; the CLI attempts acquisition per invocation and reports ownership when held (M1: report, not delegate — OD-4). One lock per clone = one engine per clone (RFC §6.2).

### 4.6 Secrets lint (`secrets.ts`, pure)

- **Pattern set (v1, high-precision only)**: AWS access key IDs (`AKIA[0-9A-Z]{16}`), GitHub tokens (`ghp_/gho_/ghu_/ghs_/ghr_/github_pat_` prefixes), GitLab PATs (`glpat-`), Slack tokens (`xox[baprs]-`), Google API keys (`AIza[0-9A-Za-z_-]{35}`), private key blocks (`-----BEGIN … PRIVATE KEY-----`), and Azure/OpenAI-style keys only where a strict prefix exists (e.g. `sk-proj-`). **No** entropy heuristics or `password=`-style patterns in v1 — false positives that block commits are their own incident class; the set is a module-level constant, trivially extendable.
- **Where it runs**: in the engine before **every** commit on **every** trigger (debounce, interval, manual CLI, `sync` tool) and at **every** ladder stage that creates a commit (normalization, conflict notes, `resolve` finalization, `chore(index)` regeneration). Lint inspects the full content of each file in the commit. Blocked commit ⇒ `SECRETS_BLOCKED` reported to the writer (tool result / CLI), the write stays pending, nothing is pushed (spec scenarios).

---

## 5. MCP server design (`src/mcp`, P2)

### 5.1 Boot and single-vault wiring

`supermemory serve --vault <path|name>`:
1. Resolve the vault: `--vault` flag → `SUPERMEMORY_VAULT` → `vaults.default` in global config (RFC §8; M1 resolves only the `default` entry for names). Unresolvable ⇒ fail fast with exactly `No vault configured. Run: supermemory setup`. The server is **never interactive** (RFC §7.2).
2. `validateBoot()` — five checks + FTS5 probe (§6.3 diagram).
3. `loadRules()` → `RulesModel`; build the catalog; open/rebuild the index if `.memory/cache/` is missing (index spec: rebuildable, deletion loses nothing).
4. Acquire the pidfile lock; start the engine + scheduler (P3; until then a stub engine answers `sync`/`status`).
5. Serve over stdio. stdout carries only protocol frames (§1.6).

### 5.2 Catalog generation (`catalog.ts`)

- Exactly **six tools** — `find`, `read_with_context`, `save`, `changes_since`, `sync`, `status` — no `project` parameter on any of them (spec scenario; `project` is an M2 surface and is *absent*, not optional).
- **`save` schema generated per note type**: discriminated by `type` (enum of declared note types); each type's frontmatter declaration becomes a zod object — `string`→`z.string()`, `enum`→`z.enum(values)`, `date`→date-shaped `z.string()`, `required: false`→`.optional()` — plus `content` (markdown body) and optional `title`. Fields flattened at the top level of the per-type object; `.strict()` so undeclared fields are rejected rather than dropped. Schemas are zod *raw shapes* handed to the SDK's tool registration (the SDK renders JSON Schema — one serialization path, no hand-rolled schema code).
- **Descriptions embed the team's prose**: each tool description is composed from `rules.md` prose sections (tool-catalog spec: "tool descriptions SHALL embed the team's own prose rules"), and `save`'s per-type description carries the type's rules (naming pattern, folder, required fields) verbatim from the model.
- **Rules are the catalog's only input**: `buildCatalog(rules)` is pure; `rules-reloaded` (§3.1) rebuilds it in place — behavior changes with no code change or redeploy (spec scenario).
- **Resource**: `rules://current` returns the parsed rules + rendered templates (RFC §5 "Resources"). **Server instructions** embed `.memory/templates/agent-instructions.md` when present (RFC §9).

### 5.3 Tool implementations (thin by design)

- `save` → schema check → `rules.validateNote` (violated rule returned verbatim) → `notes/save-pipeline`: pull-before-write (update only, via `SyncPort`) → render/merge content → maintain the target spec's **Linked Knowledge** section (append on create; idempotent on re-save — entries keyed by note id so repeated saves never duplicate; spec scenario) → `index.upsertNote` → `SyncPort.notifyWrite` → return `{ path, id }`.
- `find` → `index.queries`: filters `type | status | spec_id | tags | owner | date-range` + FTS5 free text (combined when both given); results `{ id, title, status, path }` (+ type), default limit 20.
- `read_with_context` → note + frontmatter + backlinks (wikilinks **and** `spec_id` references, from the link graph) + referenced specs' status/lifecycle + the 5 most recent linked decisions/incidents.
- `changes_since` → timestamp (ISO) → git-log walk since that time filtered to note-grammar commits, classified from the deterministic headers: `note(add)`⇒added, `note(update)` with status suffix⇒status changed, `note(update)` plain⇒updated, `note(delete)`⇒removed. Building on the grammar keeps one source of truth; "my last session" shortcuts are not in the M1 spec (timestamp only).
- `sync` → `engine.runCycle('tool')`, returns the resulting status. `status` → `engine.state`: last successful sync, pending-write count, unresolved conflicts (from open conflict notes), stale notes (frontmatter field per `lifecycle.staleness` — default `review_after` — earlier than `Clock.now()`), vault `format_version`. P2 ships these as documented stubs ("engine lands in P3; `supermemory sync`/plain git still work") — permitted by the proposal; P3 wires the real engine with no schema change.

### 5.4 Contract tests over the in-memory transport

Tests construct a server + SDK `Client` over `InMemoryTransport.createLinkedPair()` against a `createTestVault()` fixture and drive `client.callTool/listTools` — exercising the real serialization + zod-schema path without spawning processes. Assertions mirror spec scenarios: exactly six tools listed, no `project` in any input schema; save-schema reflects declared required fields; invalid save rejected naming the violated rule; Linked Knowledge dedupe; find/read_with_context round-trips. Rationale: this is the closest hermetic approximation of a real MCP client and pins the SDK surface the exact pin (OD-2) protects.

---

## 6. Sequence diagrams

### 6.1 (a) save → validation → write → debounce → sync cycle

```mermaid
sequenceDiagram
    autonumber
    participant A as MCP client (agent)
    participant T as save tool (mcp)
    participant R as rules (validate)
    participant N as save pipeline (notes)
    participant G as git (SyncPort)
    participant I as index
    participant S as scheduler (debounce)
    participant E as engine

    A->>T: save(type, fields, content)
    T->>T: zod schema check (generated from rules)
    T->>R: validateNote(rules, note)
    R-->>T: violations[] → reject, error names the violated rule
    T->>N: saveNote(note)
    N->>G: pullLatest(note) [update only: pull-before-write]
    N->>N: render template / merge; maintain Linked Knowledge (dedupe by id)
    N->>I: upsertNote(note) [index immediately consistent]
    N->>G: notifyWrite(event) → scheduler debounce window (~45s)
    N-->>T: { path, id }
    T-->>A: save result
    Note over S: window elapses (Clock/TimerPort — testable)
    S->>E: runCycle('debounce')
    E->>E: lock held (server owns) · pre-pull rules guard
    E->>E: secrets lint → commit (grammar + human author + trailers)
    E->>E: pull --rebase --autostash → regenerate maps (chore(index)) → push
    E-->>S: cycle result (status updated)
```

### 6.2 (b) pull-rebase conflict on a curated note → abort → snapshot → conflict note → guided resolve

```mermaid
sequenceDiagram
    autonumber
    participant E as engine (sync cycle)
    participant Git as git (vault repo)
    participant L as ladder
    participant V as vault filesystem
    participant St as status tool
    participant H as human

    E->>Git: commit pending writes (lint → note(...) commits)
    E->>Git: pull --rebase --autostash
    Git--xE: CONFLICT: spec same-region edit (curated)
    E->>L: conflicted paths
    L->>L: classify each path (generated / union / curated)
    Note over L: any curated conflict → whole rebase takes the curated path
    L->>Git: git rebase --abort (local state intact — nothing lost)
    L->>Git: branch conflict/<date>-<note-id> at remote tip (incoming side recoverable)
    L->>V: write conflict note conflicts/<date>-<note-id>.md (lint → chore(conflict) commit)
    L->>E: pushPaused=true; conflict open; reads/writes continue locally
    St->>St: status reports unresolved conflict + pending writes
    H->>H: supermemory resolve
    H->>H: both sides side by side (local file vs snapshot branch) → human merges
    H->>E: resolve finalize
    E->>Git: commit merged note (note(update): … conflict resolved) → push
    E->>V: conflict note → status: resolved
    St->>St: status no longer reports the conflict
```

### 6.3 (c) boot validation flow (`serve`)

```mermaid
sequenceDiagram
    autonumber
    participant U as user / MCP client host
    participant C as CLI (serve command)
    participant CF as config resolution
    participant B as boot validation
    participant P as sqlite probe (boot)
    participant R as rules loader
    participant M as MCP server

    U->>C: supermemory serve --vault <path|name>
    C->>CF: flag → SUPERMEMORY_VAULT → config vaults.default
    alt no vault resolvable
        CF-->>C: fail-fast: "No vault configured. Run: supermemory setup"
    end
    C->>B: validateBoot(vaultPath)
    B->>B: 1 exists? 2 git repo? 3 .memory/rules.md? 4 outside app repo? 5 format_version?
    Note over B: first failure aborts with AppError{code, message, hint}; nothing is served
    B->>P: probeSqlite() — FTS5 capability
    P-->>B: ok | SQLITE_FTS5_MISSING (message points at npm rebuild + TROUBLESHOOTING)
    B->>R: loadRules() (parse + checkFormatVersion)
    R-->>B: RulesModel | RULES_PARSE_ERROR / FORMAT_VERSION_UNSUPPORTED
    B-->>C: boot valid
    C->>M: buildCatalog(rules) · open/rebuild index · acquire lock · serve stdio (6 tools)
```

---

## 7. Data contracts (type-level sketches — for mechanical task slicing; not code)

```text
RulesModel        { formatVersion, noteTypes: Record<string, NoteTypeDef>, lifecycle, conflictPolicyDefaults, git }
NoteTypeDef       { folder, frontmatter: Record<string, FieldDef>, naming?, sections?, conflictPolicy }
ValidationIssue   { kind: 'field'|'pattern'|'enum'|'naming'|'folder', field?, expected, actual, message }
SyncPort          { pullLatest(notePath?): Promise<void>; notifyWrite(e: WriteEvent): void }
WriteEvent        { op: 'add'|'update'|'delete', type, id, path, via: string, at: Date }
EngineState       { lastSuccessfulSyncAt?, pendingWrites: number, conflicts: ConflictRef[], staleNotes: NoteRef[], formatVersion, pushPaused: boolean, lockOwner? }
CommitPlan        { header: string, trailers: Record<string,string>, author: { name, email } }
LadderDecision    { category: 'generated'|'union'|'curated', paths: string[], action: ... }
SyncTunables      { debounceMs: number, intervalMs: number }        // resolveSyncTunables(env, vaultConfig, rules)
```

Every pure function above (validation, message derivation, ladder classification, tunables resolution, secrets lint, template rendering) takes explicit inputs — no I/O — which is what makes the strict-TDD gates (D3) mechanical from P1 onward.

---

## 8. Phase mapping (for the tasks phase)

Chain seams follow the proposal (PR-1/PR-2/PR-3). Phase 0 (baseline commit) is the first apply task per the proposal.

### P1 — Scaffold + rules + CLI onboarding + boot validation (PR-1)

| Lands | Contents |
|---|---|
| Root scaffold | `package.json` (shape §1.1), `tsconfig.json` + `tsconfig.build.json`, `vitest.config.ts`, `.env.example`, README note (`.atl/` machine-local, D2), dependency install **with the OD-2 verification steps** |
| `src/util` | `errors.ts`, `clock.ts` (ports), `log.ts`, `paths.ts` |
| `src/config` | `env.ts`, `global-config.ts`, `vault-config.ts` (+ `resolveSyncTunables` with precedence tests) |
| `src/boot` | `validate-boot.ts` (five checks, ordering, messages — one negative fixture per check), `sqlite-probe.ts` (+ P1 smoke test = ESM interop + FTS5), `docs/TROUBLESHOOTING.md` |
| `src/rules` | `types.ts`, `parser.ts`, `templates.ts`, `validate.ts`, `version.ts` |
| `src/cli` | `index.ts` (commander program), `commands/init.ts` (scaffold `.memory/` + default folders **incl. `conflicts/`** + `.gitattributes` + validate + commit), `commands/setup.ts` (wizard; writes global config) |
| Test infra | `test/helpers/*` (`createTestVault`, `createRemote`, `env`), `test/fixtures/vault/` |
| Config backfill | flip `strict_tdd: true`; set `apply.test_command` / `verify.test_command` = `vitest run`, `verify.build_command` = `npm run build` (D3) |

Spec coverage: **rules-parsing** (all four requirements incl. format_version surface), **boot-validation** (all three requirements). Tests: parser/table-driven, renderer, validator per scenario, boot negative fixtures, probe smoke.

### P2 — SQLite index + MCP tool catalog (PR-2)

| Lands | Contents |
|---|---|
| `src/notes` | `parse.ts` (id/title derivation), `linked-knowledge.ts`, `save-pipeline.ts` (SyncPort = null impl in P2) |
| `src/index` | `db.ts`, `schema.ts`, `upsert.ts`, `queries.ts`, `rebuild.ts`, `maps.ts` (deterministic `index/` maps — needed by P3's chore(index) commits) |
| `src/mcp` | `server.ts`, `catalog.ts`, `resources.ts`, six tool files (`sync`/`status` documented stubs) |
| `src/cli` | `commands/serve.ts` |
| Tests | in-memory-transport contract tests (§5.4), cache-deletion rebuild test, incremental-upsert visibility test |

Spec coverage: **index** (all four requirements), **tool-catalog** (all requirements except engine-backed sync/status state — stubbed per proposal; save/validation scenarios exercise the rules boundary end-to-end).

### P3 — Sync engine + commit grammar + conflict ladder + secrets lint (PR-3)

| Lands | Contents |
|---|---|
| `src/sync` | `engine.ts` (cycle + §3.1 rules hook), `scheduler.ts`, `git.ts`, `commit-message.ts`, `ladder.ts`, `conflict-note.ts`, `resolve.ts`, `lock.ts`, `secrets.ts`, `state.ts` |
| `src/cli` | `commands/sync.ts`, `commands/resolve.ts` |
| Wiring | `serve.ts` injects the real engine + scheduler into the catalog's `sync`/`status`; `save-pipeline` gets the real `SyncPort` |
| Tests | debounce/interval (OD-4 timers), pull-rebase autostash survival, pull-before-write, grammar determinism + trailers, **headline never-delete test** (divergent clones → abort/snapshot/conflict-note/resolve), union sort/dedupe, generated-regeneration, secrets block on every trigger, lock single-owner/stale-reclaim, backoff without loss |

Spec coverage: **sync-ladder** (all nine requirements), completing every M1 requirement in the five specs.

---

## 9. Design-level risks & mitigations (beyond proposal risks)

| Risk | Mitigation in this design |
|---|---|
| Timer/global mutation flaking under parallel test workers | TimerPort injection + per-file fake timers (OD-4); manual port for scheduler unit tests |
| Mixed generated+curated conflicts have no clean auto path | Explicit rule: any curated conflict ⇒ whole rebase takes the curated path (§4.4) |
| Server keeps process alive via pending timers | `.unref()` on all production timers (OD-4) |
| Conflict note invisible in Obsidian | Top-level `conflicts/` folder, not under `.memory/` (§4.4) |
| Env/config overrides weakening hygiene gates | Tunables-only precedence (§3.2); secrets lint/validation never overridable |
| Unsupported rules merged before refusal | Pre-pull guard + post-sync reload (§3.1) — belt and braces |
| stdout corruption breaking MCP stdio | stderr-only logging convention (§1.6) |
| `format_version` checks drifting between boot and sync | Single `checkFormatVersion` in `src/rules/version.ts`, reused (§3) |

## 10. Explicit non-goals (guard rails for tasks/apply)

No `project` parameter, multi-vault registry, `vault add/confirm`, `install --client`, `manual`/`pr` modes or strictest-wins resolution, `~/.config/supermemory/.env` loader (M2, with modes), elicitation, `--profile`, `theirs_and_archive`, attic/staleness flags beyond the `status` stale-note listing, `migrate`. The manual `sync` trigger (tool + CLI) is the only non-auto sync surface in M1.

---

*No code changes, no commits, no installs, and no pushes were made in this phase. Design artifact only.*
