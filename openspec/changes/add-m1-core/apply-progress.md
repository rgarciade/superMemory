# Apply Progress — add-m1-core

Phase: apply (PR-1 slice) · Branch: `add-m1-core/pr1-scaffold-rules-boot` (stacked-to-main)
Scope of this apply run: **Phase 0 (0.1) + Phase 1 (1.1–1.19) only** — the PR-1 work unit of the chained delivery (PR-2 = Phase 2, PR-3 = Phase 3 come in separate runs).

## Completed tasks

| Task | Commit | Summary |
|---|---|---|
| 0.1 | `4f68c63` (main) | Baseline `chore: baseline docs + openspec` — docs/RFC.md, openspec/, .gitignore (D2: `.atl/` + `.pi/`), README note. One commit, clean tree; branch cut from it. |
| 1.1 | `b2d6c0a` | Package scaffold (ESM/NodeNext, engines ≥22, bin→dist/cli/index.js, files:[dist], no exports map), tsconfigs, vitest wired (no globals), `.env.example`, runner-proof test. |
| 1.2 | `b4e907f` | Runtime deps with OD-2 verification. Trio: SDK **1.30.0 exact** · zod **3.25.76 (~)** · better-sqlite3 **13.0.3 (^)**. SDK peers `zod ^3.25 \|\| ^4.0` → both satisfy → rule picked 3. Dry-run 186 pkgs, 0 conflicts, no `--legacy-peer-deps`. Prebuilds bundled in-package (no node-gyp). FTS5 smoke on Node v22.23.2 (sqlite 3.53.4). |
| 1.3 | `92f590a` | D3: `strict_tdd: true`, `apply.tdd: true`, test/build commands backfilled in openspec/config.yaml. vitest 5 renamed `testMatch`→`include` (same semantics — noted deviation from design §1.7's literal key). |
| 1.4 | `4df509a`/`045167c` | `createTestVault()` + committed fixture vault (rules.md v1, 5 templates, config.yml, .gitattributes, folders incl. conflicts/). |
| 1.5 | `045167c` | `createRemote()` (bare in tmp), `createClone()`, `createDivergentClones()` (fetch keeps origin/main current), `withTestEnv()`. |
| 1.6 | `20d960d` | `AppError { code, message, hint }` + the eight stable codes; `NO_VAULT_CONFIGURED_MESSAGE` exact. |
| 1.7 | `06c8c58` | `Clock`/`TimerPort` ports (unref'd production timers — OD-4), stderr-only logger (SUPERMEMORY_LOG_LEVEL), `.memory` path helpers. |
| 1.8 | `9a89d3a` | `checkFormatVersion`: same-major accepted, other majors refused naming the required version + update path. |
| 1.9 | `5722cb0` | `RulesModel` + rules.md v1 parser: fenced YAML blocks (`note_types`/`lifecycle`/`conflict_policy_defaults`/`git`), located `RULES_PARSE_ERROR` (block + file line area), no partial model, unknown blocks tolerated, `loadRules()`. |
| 1.10 | `5767eb8` | `renderTemplate` — pure `{{placeholder}}` interpolation, no logic/lookups. |
| 1.11 | `ddfa813` | `validateNote` — required/types/enums/patterns/naming/folder, every issue names the violated rule (design §3 single-owner boundary). |
| 1.12 | `a10d471` | `EnvSource` port + typed SUPERMEMORY_* reads; global config.json under `SUPERMEMORY_CONFIG_DIR` \| `~/.config/supermemory`. |
| 1.13 | `58467be` | `loadVaultConfig` + `resolveSyncTunables` precedence env > config.yml `sync:` > rules `git:` > built-ins (15 min/45 s), per-knob; timing knobs only. |
| 1.14 | `af795d2` | `probeSqlite()` FTS5 probe with the exact OD-3 wording contract; passing test doubles as better-sqlite3 ESM-interop proof; `docs/TROUBLESHOOTING.md` (#fts5). |
| 1.15 | `985332c` | `validateBoot` five ordered fail-fast checks incl. inside-app-repo guard (`appRepoRoot()` walk) and format_version via 1.8. |
| 1.16 | `3f81ce1` | Commander program: `buildProgram`, `runMain` (exitOverride; AppError→stderr+exit 1; help/version paths), shebang + bin guard; init/setup registrations (stubs). |
| 1.17 | `d1c2602` | `initVault`: full scaffold (rules v1 + git tunable seed, templates, config.yml, folders incl. top-level conflicts/, vault .gitignore, .gitattributes), validateBoot, exactly one `chore(supermemory): initialize vault` commit; drift-pinned byte-equal to the fixture. |
| 1.18 | `44ca455` | `runSetup` wizard behind `PromptPort` seam: validated vault path (re-prompt), author identity (defaults from vault git config), writes `vaults.default` + author. |
| 1.19 | (this commit) | Phase gate: `npm test` **120/120 across 21 files**; `npm run typecheck` clean; `npm run build` clean (dist/cli/index.js, shebang preserved); hermeticity guards `test/p1/gate.test.ts`. |

## TDD Cycle Evidence (strict_tdd active from 1.4 onward)

| Task | RED (failing first) | GREEN | Notes |
|---|---|---|---|
| 1.6 | `Cannot find module '../../src/util/errors.js'` — 4 assertions failing | 4/4 | — |
| 1.7 | 3 test files failing on missing clock/log/paths modules | 31/31 suite | unref test rewritten: assert `.unref()` on the handles the globals return (Node setTimeout takes no options object) |
| 1.8 | module missing — 7 failing | 7/7 | — |
| 1.9 | module missing — file failed to load | 15/15 file | mid-cycle: YAML unquoted `1.0` parses as number (version check accepts string\|number); fenced blocks unwrap their identity key; test-table colon bug fixed (impl reproved via tsx before test fix) |
| 1.10 | module missing — 6 failing | 6/6 | — |
| 1.11 | module missing — 8-blocker cascade | 69/69 suite | — |
| 1.12 | 2 files failing on missing modules | 82/82 suite | — |
| 1.13 | module missing | 91/91 suite | mid-cycle: `sync:` key with only comments is YAML null → normalized to {} |
| 1.14 | module missing | 93/93 suite | AppError gained standard `cause` passthrough (real type error found by checker) |
| 1.15 | module missing | 100/100 suite | test bugs fixed: app-root recompute drifted a level; inside-app fixture now passes checks 1–3 (ephemeral mini-vault in the real app root) |
| 1.16 | module missing (4-blocker cascade) | 106/106 suite | commander exitOverride so parse errors never throw |
| 1.17 | `initVault` not exported — 8 failing | 114/114 suite | drift pin: scaffold bytes ≡ committed fixture |
| 1.18 | `runSetup`/`PromptPort` not exported — 3 failing | 117/117 suite | scripted PromptPort; @inquirer at the edge only |
| 1.19 | n/a (verification guards, not feature code) | 120/120 suite | gate guards: tmp-only config writes, vaults under os.tmpdir(), env restoration |

## Files changed (PR-1 slice)

- Created: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.env.example`, `README.md`, `docs/TROUBLESHOOTING.md`
- `src/util/`: `errors.ts`, `clock.ts`, `log.ts`, `paths.ts`
- `src/rules/`: `types.ts`, `parser.ts`, `templates.ts`, `validate.ts`, `version.ts`
- `src/config/`: `env.ts`, `global-config.ts`, `vault-config.ts`
- `src/boot/`: `validate-boot.ts`, `sqlite-probe.ts`
- `src/cli/`: `index.ts`, `commands/init.ts`, `commands/setup.ts`
- `test/`: `helpers/` (create-test-vault, create-remote, env), `fixtures/vault/**`, `util/`, `rules/`, `config/`, `boot/`, `cli/`, `p1/gate.test.ts`, `scaffold.test.ts`
- Modified: `.gitignore`, `openspec/config.yaml`, `openspec/changes/add-m1-core/tasks.md`, this file

## Deviations from design

1. **vitest 5 `include` instead of `testMatch`** (1.1/1.3) — vitest 5 removed `testMatch`; same semantics.
2. **simple-git 3.x has no public env seam** (1.4) — fixed-date commits use a scoped `execFile` env; `process.env` never mutated.
3. **RFC §4.5 `.gitattributes` inline comments are invalid gitattributes syntax** (1.4/1.17) — standalone comments used in fixture and init defaults.
4. **YAML unquoted `format_version: 1.0` parses as number** (1.9) — `checkFormatVersion` accepts `string | number`; `normalizeFormatVersion` renders integers with one decimal (1 → "1.0").
5. **TypeScript 5.9 line instead of latest 7.x** (1.1) — TS 7 (native compiler) is too fresh for the vitest/tsx toolchain; design named no version.
6. **`esModuleInterop: true` added** (1.9) — required for NodeNext default-imports of CJS deps (`gray-matter`, `better-sqlite3`); matches Node runtime semantics.

## Remaining tasks

- Phase 2 (2.1–2.18): SQLite index + MCP tool catalog — PR-2, separate apply run on a branch stacked on this one.
- Phase 3 (3.1–3.14): sync engine + grammar + ladder + secrets — PR-3, separate apply run.

## Workload / PR boundary

- PR-1 = Phase 0 + Phase 1 on `add-m1-core/pr1-scaffold-rules-boot`, base `main`. Estimated ~1,850 lines (forecast) — over the 400-line budget by design; authorized by the resolved chained delivery (stacked-to-main), not a size:exception.
- No push, no PR creation, no npm publish (user-owned).
