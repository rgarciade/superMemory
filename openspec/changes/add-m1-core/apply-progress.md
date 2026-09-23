# Apply Progress — add-m1-core

Phase: apply · Chained delivery (stacked-to-main): PR-1 complete (open as GitHub PR #1) on
`add-m1-core/pr1-scaffold-rules-boot`; this file also covers PR-2 in full — all of
Phase 2, tasks 2.1–2.18 (in-memory index + notes layer + MCP catalog/tools/server/
serve + P2 phase gate) — on `add-m1-core/pr2-index-notes`, stacked on PR-1. Only
Phase 3 (3.1–3.14, PR-3) remains, in a separate apply run.
Scope of the original apply run this file started from: **Phase 0 (0.1) + Phase 1 (1.1–1.19) only** — the PR-1 work unit of the chained delivery.

**Note on commit SHAs below**: git history for this branch was rewritten (author email correction) after the table below was first written. All SHAs in this file are the post-rewrite (current) SHAs.

## Completed tasks

| Task | Commit | Summary |
|---|---|---|
| 0.1 | `a1fd6be` (main) | Baseline `chore: baseline docs + openspec` — docs/RFC.md, openspec/, .gitignore (D2: `.atl/` + `.pi/`), README note. One commit, clean tree; branch cut from it. |
| 1.1 | `6594e56` | Package scaffold (ESM/NodeNext, engines ≥22, bin→dist/cli/index.js, files:[dist], no exports map), tsconfigs, vitest wired (no globals), `.env.example`, runner-proof test. |
| 1.2 | `925bcd4` | Runtime deps with OD-2 verification. Trio: SDK **1.30.0 exact** · zod **3.25.76 (~)** · better-sqlite3 **13.0.3 (^)**. SDK peers `zod ^3.25 \|\| ^4.0` → both satisfy → rule picked 3. Dry-run 186 pkgs, 0 conflicts, no `--legacy-peer-deps`. Prebuilds bundled in-package (no node-gyp). FTS5 smoke on Node v22.23.2 (sqlite 3.53.4). |
| 1.3 | `59768a5` | D3: `strict_tdd: true`, `apply.tdd: true`, test/build commands backfilled in openspec/config.yaml. vitest 5 renamed `testMatch`→`include` (same semantics — noted deviation from design §1.7's literal key). |
| 1.4 | `a3e2fe1`/`65c17da` | `createTestVault()` + committed fixture vault (rules.md v1, 5 templates, config.yml, .gitattributes, folders incl. conflicts/). |
| 1.5 | `65c17da` | `createRemote()` (bare in tmp), `createClone()`, `createDivergentClones()` (fetch keeps origin/main current), `withTestEnv()`. |
| 1.6 | `ecfe9a0` | `AppError { code, message, hint }` + the eight stable codes; `NO_VAULT_CONFIGURED_MESSAGE` exact. |
| 1.7 | `dd9d507` | `Clock`/`TimerPort` ports (unref'd production timers — OD-4), stderr-only logger (SUPERMEMORY_LOG_LEVEL), `.memory` path helpers. |
| 1.8 | `0943e9a` | `checkFormatVersion`: same-major accepted, other majors refused naming the required version + update path. |
| 1.9 | `df7c9d8` | `RulesModel` + rules.md v1 parser: fenced YAML blocks (`note_types`/`lifecycle`/`conflict_policy_defaults`/`git`), located `RULES_PARSE_ERROR` (block + file line area), no partial model, unknown blocks tolerated, `loadRules()`. |
| 1.10 | `b08fecc` | `renderTemplate` — pure `{{placeholder}}` interpolation, no logic/lookups. |
| 1.11 | `c77c30c` | `validateNote` — required/types/enums/patterns/naming/folder, every issue names the violated rule (design §3 single-owner boundary). |
| 1.12 | `b0beba0` | `EnvSource` port + typed SUPERMEMORY_* reads; global config.json under `SUPERMEMORY_CONFIG_DIR` \| `~/.config/supermemory`. |
| 1.13 | `6b95cf4` | `loadVaultConfig` + `resolveSyncTunables` precedence env > config.yml `sync:` > rules `git:` > built-ins (15 min/45 s), per-knob; timing knobs only. |
| 1.14 | `34deeeb` | `probeSqlite()` FTS5 probe with the exact OD-3 wording contract; passing test doubles as better-sqlite3 ESM-interop proof; `docs/TROUBLESHOOTING.md` (#fts5). |
| 1.15 | `92bc9c6` | `validateBoot` five ordered fail-fast checks incl. inside-app-repo guard (`appRepoRoot()` walk) and format_version via 1.8. |
| 1.16 | `3e58c32` | Commander program: `buildProgram`, `runMain` (exitOverride; AppError→stderr+exit 1; help/version paths), shebang + bin guard; init/setup registrations (stubs). |
| 1.17 | `b6c4246` | `initVault`: full scaffold (rules v1 + git tunable seed, templates, config.yml, folders incl. top-level conflicts/, vault .gitignore, .gitattributes), validateBoot, exactly one `chore(supermemory): initialize vault` commit; drift-pinned byte-equal to the fixture. |
| 1.18 | `206c7b9` | `runSetup` wizard behind `PromptPort` seam: validated vault path (re-prompt), author identity (defaults from vault git config), writes `vaults.default` + author. |
| 1.19 | `b15322e` | Phase gate: `npm test` **120/120 across 21 files**; `npm run typecheck` clean; `npm run build` clean (dist/cli/index.js, shebang preserved); hermeticity guards `test/p1/gate.test.ts`. |

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

### Remediation batch (1st) — additional files changed

- Created: `test/setup/git-env.ts` (vitest `setupFiles` entry — process-wide git config isolation, plus opt-in `buildHermeticGitEnv`), `test/setup/git-env.test.ts`
- Modified: `src/cli/index.ts`, `src/util/paths.ts`, `src/boot/validate-boot.ts`, `src/cli/commands/init.ts`, `src/cli/commands/setup.ts`, `src/rules/validate.ts`, `vitest.config.ts`
- Modified (tests): `test/cli/index.test.ts`, `test/util/paths.test.ts`, `test/boot/validate-boot.test.ts`, `test/cli/commands/init.test.ts`, `test/cli/commands/setup.test.ts`, `test/rules/validate.test.ts`, `test/p1/gate.test.ts`
- Modified (docs): `openspec/changes/add-m1-core/tasks.md` (SHA refresh only), this file (SHA refresh + remediation section)

### Remediation batch (2nd) — additional files changed

- Created: `test/repo-hygiene.test.ts`
- Modified: `src/cli/commands/init.ts` (tracked rollback, commit pathspec, merge eol/negation), `src/boot/validate-boot.ts` (realpathSync.native), `test/setup/git-env.ts` (broader isolation + in-place clearing), `vitest.config.ts` (comment fix), `.gitignore` (`tmp-sm-*/`)
- Modified (tests): `test/cli/commands/init.test.ts`, `test/boot/validate-boot.test.ts`, `test/setup/git-env.test.ts`
- Modified (docs): this file (second remediation batch section)

### Remediation batch (3rd) — additional files changed

- Modified: `src/cli/commands/init.ts` only (write-before-track + `wx`, index-entry snapshot/restore, raw-byte merge, symlink guard, `-f` staging, rollback-issue reporting, preexisting-path tracking + `InitResult.preexistingUntouched` + CLI warning)
- Modified (tests): `test/cli/commands/init.test.ts` only
- Modified (docs): this file (third remediation batch section)

## Deviations from design

1. **vitest 5 `include` instead of `testMatch`** (1.1/1.3) — vitest 5 removed `testMatch`; same semantics.
2. **simple-git 3.x has no public env seam** (1.4) — fixed-date commits use a scoped `execFile` env; `process.env` never mutated.
3. **RFC §4.5 `.gitattributes` inline comments are invalid gitattributes syntax** (1.4/1.17) — standalone comments used in fixture and init defaults.
4. **YAML unquoted `format_version: 1.0` parses as number** (1.9) — `checkFormatVersion` accepts `string | number`; `normalizeFormatVersion` renders integers with one decimal (1 → "1.0").
5. **TypeScript 5.9 line instead of latest 7.x** (1.1) — TS 7 (native compiler) is too fresh for the vitest/tsx toolchain; design named no version.
6. **`esModuleInterop: true` added** (1.9) — required for NodeNext default-imports of CJS deps (`gray-matter`, `better-sqlite3`); matches Node runtime semantics.

## Remediation batch (post-review fixes, PR-1 slice)

A fresh-context pre-PR review blocked this PR on 8 findings (2 CRITICAL, 6 WARNING). All 8 are fixed on this same branch, each as its own RED→GREEN work-unit commit (strict TDD). `npm test` (148/148), `npm run typecheck`, and `npm run build` all pass after every commit in this batch.

| # | Finding | Commit | Fix |
|---|---|---|---|
| 1 | CRITICAL — `init` could write into and commit the app repo itself (guard ran post-write; `git add .`; clobbered existing `.gitignore`/`.gitattributes`) | `e15756e` | Guard 4 (not-inside-app-repo) now runs before any write; vault-level `.gitignore`/`.gitattributes` merge missing lines instead of overwriting, `config.yml`/templates are write-if-absent; commit stages exactly the scaffold's relative paths, never `git add "."` |
| 1 (root cause) | `isInsideDir(parent, child)` returns `false` for equal paths, so check 4 passed for `vaultPath === appRoot` | `7b0cfde` | Added `isSameOrInsideDir` (parent-or-inside) alongside `isInsideDir` (contract unchanged); extracted `assertVaultOutsideAppRepo`, both sides resolved via `realpathSync` so a symlink alias can't bypass it |
| 2 | CRITICAL — `invokedAsBin` compared `import.meta.url` (realpath) to raw `argv[1]`, so a bin symlink invocation (global install/npx/npm link) silently no-op'd, exit 0 | `b9bf58a` | `isInvokedAsBin` resolves `argv[1]` with `realpathSync` before comparing; regression test goes through a real symlink |
| 3 | WARNING — `isCommanderExit` matched any `Error` with a string `code`, swallowing Node fs errors (EACCES etc.) as silent exit 1 | `b9bf58a` (same commit as #2 — same function, same review pass) | Narrowed to `err instanceof CommanderError` |
| 4 | WARNING — failed initial commit left an uncommitted scaffold; re-run refused ("rules.md already exists"); hint always blamed git identity | `e15756e` (same commit as #1 — same commit/rollback code path) | On failure, roll back `.memory/` so a re-run resumes; underlying error message surfaced instead of a blanket guess |
| 5 | WARNING — `committed: true` hard-coded; simple-git resolves normally (no throw) when there is nothing to commit | `e15756e` (same commit as #1/#4) | Extracted `commitInitScaffold`, throws when the commit result's `commit` hash is empty; unit-tested with a stub `SimpleGit` |
| 6 | WARNING — date fields rejected gray-matter's `Date` instances (unquoted YAML `date: 2026-09-22` parses as `Date`, not string) | `308a8a4` | `checkFieldType`'s `date` case accepts a valid `Date` instance directly |
| 7 | WARNING — setup wizard saved the vault path as typed (relative paths break after a cwd change; `~` rejected); "Try another path? No" still re-prompted | `2ad3f5c` | `resolveVaultPath` expands `~` and `path.resolve`s before validating/saving; loop breaks on a `No` answer |
| 8 | WARNING — test git depended on the developer/CI's own `~/.gitconfig`/`/etc/gitconfig`; `gate.test.ts` failed if `SUPERMEMORY_VAULT` was already exported | `68fdf2e` | New vitest `setupFiles` entry (`test/setup/git-env.ts`) sets `GIT_CONFIG_GLOBAL=/dev/null` + `GIT_CONFIG_NOSYSTEM=1` process-wide (safe: never touches local repo config); two `setup.test.ts` commits given their own local identity; `gate.test.ts` saves/clears/restores `SUPERMEMORY_VAULT` itself |

Grouping note: findings #2+#3 share one commit (same function, `isCommanderExit`/`isInvokedAsBin` sit a few lines apart in `src/cli/index.ts`, discovered in the same review pass — splitting them would have been artificial). Findings #1's init.ts guard-ordering/never-clobber/explicit-staging fix and findings #4/#5 (rollback + real commit-success check) share one commit — they are the same `initVault` commit/rollback code path and cannot be meaningfully separated. All other findings are one commit each.

### TDD Cycle Evidence — remediation batch

| Finding | RED (failing first) | GREEN | Notes |
|---|---|---|---|
| 1 (init.ts) | 7 new tests failing: guard-before-write leaked `.memory/` into an app-repo-nested vault; gitignore/gitattributes clobbered; `.env`/`draft.md` got staged; commit-failure message missing the real cause; `commitInitScaffold` undefined | 15/15 | Manually reproduced the "nothing to commit → resolves, no throw" simple-git behavior first (`git.commit()` on an empty `git add .` resolves `{commit:""}`, no throw) before writing the stub-based regression test |
| 1 (paths/validate-boot) | `isSameOrInsideDir`/`assertVaultOutsideAppRepo` undefined — 6 failing | 18/18 | Confirmed root cause manually first: `isInsideDir(root, root)` → `false` |
| 2/3 | `isInvokedAsBin` undefined; fs-error test asserted non-empty stderr, got `''` | 11/11 | — |
| 6 | gray-matter parses unquoted `date: 2026-09-22` as `Date`; validator rejected it (`typeof` check) | 13/13 | — |
| 7 | relative-path/`~`/decline-loop assertions failed against the old behavior | 6/6 | — |
| 8 | `git-env.ts` module missing; `gate.test.ts`'s SUPERMEMORY_VAULT test failed when the var was pre-set (reproduced via `git stash` + env var) | 4/4 (git-env) + 3/3 (gate) | Manually reproduced the reported CI failure mode first: `user.useConfigOnly=true` + no identity + isolated env → `fatal: no email was given and auto-detection is disabled`, exit 128 |

### Out of scope (left for a later remediation batch)

- Empty `SUPERMEMORY_CONFIG_DIR=""` writes `config.json` into cwd (`src/config/global-config.ts:19`).
- Unvalidated timing values from `config.yml`/rules `git:` block (0, negative, NaN sync intervals).
- Malformed frontmatter throws a raw `YAMLException` instead of `RULES_PARSE_ERROR`.
- `appRepoRoot()` falls back to `/` if no `package.json` named `supermemory` is found walking up.
- ~~The check-4 test in `validate-boot.test.ts` creates `tmp-sm-inside-*` directories directly in the repo root without a `.gitignore` entry for that prefix~~ — fixed in the second remediation batch (N6).

## Second remediation batch (post-re-review fixes, PR-1 slice)

A second fresh-context re-review re-blocked the PR: findings #2/#3/#5/#6/#7/#8 from the first batch were confirmed FIXED, but #1 and #4 were only PARTIAL — the rollback mechanism added to fix them could itself delete pre-existing user data. Fixed all of it (N1–N7) on the same branch, strict TDD throughout. `npm test` (164/164), `npm run typecheck`, and `npm run build` all pass at the end of the batch.

| # | Finding | Commit | Fix |
|---|---|---|---|
| N1 | CRITICAL — `rollbackScaffold` did `rm(memoryDir, {recursive:true})` on ANY failure — a vault whose `.memory/` already held unrelated content (notes, a hand-written config.yml, a custom template — none of them `rules.md`, so check 3 didn't catch it) lost all of it, permanently, the moment a pre-commit hook rejected the commit | `a09c4e6` | Rollback now tracks every directory/file this run created and the original bytes of every merged file, then undoes ONLY that: created files deleted, created dirs removed deepest-first and only if now empty, merged files restored to their exact original bytes. Pre-existing content is never touched |
| #4 (fully fixed) | PARTIAL in batch 1 — a write failure BEFORE the commit try block (e.g. EACCES on a pre-existing read-only `specs/`) escaped uncaught: no AppError, no rollback, `rules.md` left behind blocking a re-run | `a09c4e6` (same commit as N1 — same tracked-write/rollback mechanism) | The entire tracked write phase (not just validateBoot+commit) is now wrapped; every failure after the first write rolls back the same way |
| N4 | After a failed commit the git index stayed dirty (everything staged stayed staged) even though the files were gone — the "scaffold was rolled back" hint was not fully true | `a09c4e6` (same commit — same rollback path) | Rollback also unstages exactly what this run staged (`git reset -q -- <paths>`, safe on an unborn branch since it never references HEAD); hint text now describes what actually happened |
| N2 | WARNING — `git commit` with no pathspec after `git add(relativePaths)` commits the ENTIRE index, so a file the user had already staged before running init (e.g. `git add .env`) rode along into the init commit | `c514e2e` | `git.commit(message, relativePaths)` restricts the commit itself to the scaffold paths; the user's own staged changes stay staged, untouched (not committed, not discarded) |
| N3 | WARNING — `realpathSync` (the plain JS implementation) preserves input case even on a case-insensitive-but-case-preserving filesystem (macOS APFS default, Windows), so a differently-cased alias of the app repo root bypassed `assertVaultOutsideAppRepo` | `d7d79ed` | Use `realpathSync.native` (the OS syscall) on both sides instead — case-corrects; ENOENT handling unchanged |
| N5 | WARNING — `test/setup/git-env.ts` only cleared `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_NOSYSTEM`; a worker launched from a git hook can inherit `GIT_DIR`/`GIT_INDEX_FILE`/`GIT_WORK_TREE`, silently redirecting every child `git` process; `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`/`GIT_CONFIG_PARAMETERS` is a second, uncovered env-based config-injection path; `vitest.config.ts`'s comment claimed a "fixed working identity" that was deliberately NOT applied | `b47c0f0` | Clears all of the above (mutating `process.env` in place — `Object.assign` can't delete keys, a real bug caught while implementing this); comment corrected |
| N6 | WARNING — two tests intentionally create `tmp-sm-*` directories at the repo root (the "vault inside the app repo" guard needs a target genuinely inside this repo) with no gitignore entry | `b47c0f0` (same commit as N5 — grouped per the "cheap follow-ups, one commit" instruction) | Added `tmp-sm-*/` to `.gitignore` |
| N7 | WARNING — `mergeMissingLines` didn't preserve CRLF line endings and treated a line as "present" even if a later `!line` negated it (gitignore last-match-wins semantics) | `a09c4e6` (implementation landed with the N1 rollback rewrite — same function, rewritten for tracking anyway); tests added in `b47c0f0` | Detects and preserves the file's own EOL (LF/CRLF); `isEffectivelyPresent` only counts the LAST occurrence among a line and its negation |

Grouping notes: N1/#4/N4 share one commit — they are the exact same tracked-write/rollback mechanism in `initVault` and cannot be meaningfully separated. N5/N6 share one commit per the orchestrator's explicit "cheap follow-ups, one commit is fine" instruction. N7's implementation landed inside the N1 commit (the function it lives in — `mergeMissingLines` — was already being rewritten for tracking; rewriting it twice in two separate commits would have been artificial), with its dedicated regression tests added in the N5/N6 follow-up commit.

**Process deviation, disclosed**: the `c514e2e` (N2) commit's `git add` swept in the test file's already-written-but-not-yet-implemented N1/#4/N4 RED tests (same file, `test/cli/commands/init.test.ts`), because they were staged together by path rather than by hunk. That commit is transiently red in isolation (6 failing tests) until `a09c4e6` lands immediately after. HEAD (the final state) is fully green; no commit was amended or reordered to hide this — it's disclosed here instead.

### TDD Cycle Evidence — second remediation batch

| Finding | RED (failing first) | GREEN | Notes |
|---|---|---|---|
| N1/#4/N4 (init.ts rollback) | 7 new tests failing, incl. a direct data-loss repro: `readFile(".memory/notes.txt")` → `ENOENT` (the file was deleted by the old wholesale `rm`) | 22/22 (init.test.ts) | Also manually reproduced `git reset -q -- <path>` working on an unborn branch (exit 0) via raw bash before relying on it in rollback |
| N2 (commit pathspec) | Manual repro first: `git commit` (no pathspec) after staging both `.env` and `scaffold.txt` put both in `git show --stat` | 1/1 dedicated test, 22/22 file | `git.commit(message, [paths])` confirmed via manual repro to leave `.env` staged-but-uncommitted |
| N3 (case-variant realpath) | `assertVaultOutsideAppRepo(upperCasedAppRoot)` did not throw; manually confirmed root cause first (`realpathSync.native` vs `realpathSync` on a real `MixedCase`/`MIXEDCASE` dir) | 11/11 (validate-boot.test.ts) | Test skips gracefully (not fail) on a case-sensitive filesystem |
| N5 (git env noise) | `buildHermeticGitConfigIsolation` left `GIT_DIR`/`GIT_CONFIG_COUNT`/etc. untouched; integration repro: a poisoned `GIT_DIR`/`GIT_WORK_TREE` made `git rev-parse --show-toplevel` resolve to a decoy repo instead of the real one | 9/9 (git-env.test.ts) | Also caught and fixed, via a dedicated RED test, that the `apply*` functions used `Object.assign` to "clear" vars — which cannot delete a key already present on the target |
| N6 (tmp-sm-* gitignore) | `git check-ignore` on a freshly created `tmp-sm-hygiene-test-*` dir at the repo root returned false (not ignored) | 1/1 (repo-hygiene.test.ts) | — |
| N7 (merge eol/negation) | Sanity-checked the tests themselves catch a regression: temporarily reverted `isEffectivelyPresent` to a naive `.includes()` check and confirmed the negation test fails, then restored the real implementation | 3/3 dedicated tests, 25/25 file | — |

### Out of scope (unchanged from batch 1, plus nothing new added)

Same list as above — no new deferred items from this batch.

## Third remediation batch (post-re-re-review fixes, PR-1 slice)

A third fresh-context review returned MERGEABLE WITH FIXES (no criticals — the second batch's N1 data-loss fix held) on 7 remaining init.ts edge cases (W1–W5, S1, S2). All 7 are fixed on the same branch, one RED→GREEN work-unit commit per fix, strict TDD throughout. **New process rule for this batch**: every commit must be green in isolation — `npm test` was run to completion (green) immediately before every commit below, with only that fix's test+implementation staged (not a full-file `git add`), so no commit in this batch bundles a later fix's not-yet-implemented RED tests the way `c514e2e` did in batch 2. `npm test` (182/182), `npm run typecheck`, and `npm run build` all pass at the end.

| # | Finding | Commit | Fix |
|---|---|---|---|
| W1 | A path was registered in the rollback tracker only AFTER its write succeeded. Under `ulimit -f 2`, writing rules.md (~2.2 KB) failed with EFBIG after ~2 KB, leaving a truncated file the tracker never learned about — rollback couldn't remove it, every re-run refused ("already has rules.md") | `ac4ec94` | Track the path BEFORE writing (rules.md, writeIfAbsent's targets, ensureDir's directories); scaffold file writes use `{flag: "wx"}` (exclusive create), closing the exists-check/write race too |
| W2 | Rollback unstaged via `git reset -- <paths>`, which resets the INDEX to HEAD — not to what the user had staged. A `.gitignore` staged with content differing from both HEAD and the merge init produced was silently lost on rollback (reproduced both with and without a HEAD) | `4a08af5` | Snapshot each scaffold path's index entry (`git ls-files -s`) before staging; restore exactly via `git update-index --cacheinfo` (has an entry) or `--force-remove` (had none) — both work with or without a HEAD |
| W3 | `.gitignore`/`.gitattributes` were read/written as UTF-8 text. A raw non-UTF8 byte (Latin-1 0xE9) was silently turned into the UTF-8 replacement character (EF BF BD) on both the success path (what gets committed) and the rollback path (what gets "restored") | `0f0411b` | Read/write these files as raw `Buffer`s throughout; merge logic operates on raw newline-delimited byte slices, never decodes the file as text |
| W4 | `existsSync`/`writeFile`/`mkdir` all follow symlinks. A dangling `.memory/config.yml` symlink made init write the config OUTSIDE the vault; a symlinked `.gitignore` made a successful run append to and commit whatever the link pointed at outside the vault | `7923e1e` | `assertNoScaffoldSymlinks`: `lstat` (never follows symlinks) on every scaffold path, default folder, and the vault root itself, before any write; refuses with an AppError if any is a symlink |
| W5 | `git add` without `-f` fails (exit 1, not a silent skip) when `core.excludesFile` matches a scaffold path — e.g. an excludes file listing `logs` made init always fail | `cb53e54` | `git add -f -- <scaffold paths>` — still only ever the explicit scaffold paths, never a directory glob |
| S1 | Rollback errors were swallowed (bare `catch {}`), yet the final hint unconditionally claimed "Everything this run created was removed". Reproduced: staged `.gitignore` + read-only `.git` → both the original `git add` AND the rollback's own index-restore attempt failed the same way, but the old code reported a clean rollback | `1ef242d` | `rollbackScaffold`/`restoreIndexEntries` collect every step they could not undo (path + reason) and return it; the caller builds a truthful hint — full "everything undone" only when the issue list is empty, otherwise the specific paths/reasons are listed alongside the original cause. `ENOTEMPTY`/`ENOENT` on a directory removal is correctly NOT treated as a failure (expected outcome) |
| S2 | Every scaffold path was staged and committed unconditionally just for existing at that path when init finished — a custom `.memory/config.yml`, an `index/.gitkeep` with real content, or an already-compliant `.gitignore` got committed without the user ever reviewing them | `4fcecfe` | `writeIfAbsent`/`mergeMissingLines` report whether they actually wrote anything; only truly created/changed paths are staged/committed. Everything else is left untouched and returned as `InitResult.preexistingUntouched` (relative paths); the CLI warns about them by name, pointing at `git add` |

No fixes in this batch shared a commit — each addressed a genuinely distinct code path (even where several touch `init.ts`, none are the same mechanism).

### TDD Cycle Evidence — third remediation batch

| Finding | RED (failing first) | GREEN | Notes |
|---|---|---|---|
| W1 | Manually reproduced first via a standalone harness (`ulimit -f 2` + tsx, no build needed): `EFBIG` after 2048 bytes, truncated rules.md left on disk. Same repro then written as a real vitest test (spawns `initVault` via tsx under the rlimit) | 26/26 (init.test.ts) | Real OS-level repro, not a mock |
| W2 | Manual repro first (`git ls-files -s` / `update-index --cacheinfo` round-trip in raw bash); then two vitest tests (with and without a HEAD) both failed against the old `git reset` rollback | 29/29 | Confirmed `git reset -- path` on an unborn branch fully drops the entry (`fatal: path exists on disk, but not in the index`) |
| W3 | Built a Latin-1 byte (`0xE9`) via `Buffer`, wrote it as `.gitignore`; both the rollback-restore test and the successful-merge test failed (`Buffer.equals` false — bytes had been re-encoded) | 31/31 | — |
| W4 | Two of three symlink scenarios failed (init succeeded instead of refusing); the third (a symlinked default folder) already incidentally passed even before the fix, because git itself refuses to `add` a path traversing a symlinked directory — kept as a regression guard, noted as not literally RED | 34/34 | Confirmed via `lstat` that the link itself, and the outside target, were both left untouched after the fix |
| W5 | Manual repro first (raw bash: `git add` on a path matched by `core.excludesFile` exits 1); vitest test using a LOCAL (never global) excludesFile on a disposable repo reproduced the same `initVault` failure | 36/36 | Also updated `commitInitScaffold`'s existing fake-git unit tests (added a `raw` stub) and added a dedicated spy test asserting `["add","-f","--",...]` |
| S1 | Direct unit tests of exported `rollbackScaffold` (hand-built tracker + a real EACCES via `chmod 0500` on a parent dir) failed (`newScaffoldTracker`/`rollbackScaffold` not exported yet); end-to-end test (staged `.gitignore` + read-only `.git`) failed because the hint falsely claimed full success | 39/39 | Real EACCES both at the unit level and end-to-end (`.git` chmod'd read-only) |
| S2 | Four tests (custom config.yml, gitkeep with content, already-compliant gitignore, custom template) all failed: `result.preexistingUntouched` was `undefined` (field didn't exist) | 43/43 | — |

### Isolation verification note

Attempted `git archive <sha> \| tar -x -C <mktemp>` + a symlinked `node_modules` for `ac4ec94`: 164/165 tests passed; the one failure (`test/repo-hygiene.test.ts`) is a false failure of the *verification method itself* — `git archive` extracts the tree without `.git`, and that test calls `git check-ignore`, which requires an actual git repository to exist at all. Every other test (including the whole of `init.test.ts`, this batch's actual subject) passed cleanly in the archived checkout. Given this tooling limitation, the remaining 6 commits were verified with the sanctioned alternative instead: `npm test` run to completion (green) from the real repo immediately before each commit, with only that fix's files staged.

### Out of scope (unchanged — no new deferred items from this batch)

Same deferred list as batches 1–2.

## Known follow-ups

- [x] **W4 regression — symlinked vault root wrongly refused.** A final scoped review (MERGEABLE, PR #1) found that the W4 symlink guard (`assertNoScaffoldSymlinks`) put `vaultPath` itself in its `lstat` candidates, so `init <link>` was refused while `init <link>/` and `cd <link> && init .` both succeeded (reproduced) — blocking a common setup (a vault symlinked into iCloud/Dropbox) via a check that was trivially bypassed anyway. A symlinked root is not the threat W4 guards against: writes through it land inside the real vault either way. Fixed in a 4th remediation commit: `initVault` now resolves the vault root once via `realpathSync.native` and uses that resolved root for every downstream guard, write, and git operation (including the returned `InitResult.root`); the symlink guard no longer checks the root itself, only scaffold paths and default folders below it (`.memory`, `.memory/templates`, `config.yml`, `logs/`, `.gitignore`, etc. — still refused). See the commit log for the exact SHA.

## PR-1 follow-up — task 1.20 (SQLite removal, design OD-5; OD-3 withdrawn)

Lands after the PR-1 phase gate (1.19), on the same branch. Strips everything PR-1 shipped for the abandoned derived-SQLite index now that OD-5 replaced it with an in-memory index.

**Mode note (deviation from the standard RED→GREEN cycle, disclosed)**: this is a pure deletion task — no new behavior, nothing to describe with a failing test. Strict TDD's RED→GREEN→REFACTOR cycle does not apply to removing dead code; the equivalent discipline used instead is the "Safety Net" step from `strict-tdd.md` (§0): full suite run before and after, with the test-count delta reconciled exactly against what was deleted. No task in this batch wrote a new failing test first, and none needed to.

| Task | Commit | Summary |
|---|---|---|
| 1.20 | `48baf9f` | Dropped `better-sqlite3`/`@types/better-sqlite3` from `package.json` + regenerated `package-lock.json` (`npm uninstall`); deleted `src/boot/sqlite-probe.ts` + `test/boot/sqlite-probe.test.ts`; removed `SQLITE_FTS5_MISSING` from `AppErrorCode`/`ERROR_CODES` (`src/util/errors.ts`) + its assertion (`test/util/errors.test.ts`); deleted `docs/TROUBLESHOOTING.md` (only content was `#fts5`, no links elsewhere); reworded the better-sqlite3 example in the closeable-registration doc comment (`test/helpers/create-test-vault.ts:63`) — helper behavior unchanged; reworded an unrelated "FTS5" example string in `test/rules/templates.test.ts` (arbitrary template-fixture content, not the removed feature) so the grep gate is fully clean. |

**Safety net (before/after full suite)**:
- Before: `npm test` **185/185** across **23 files**.
- After: `npm test` **183/183** across **22 files**.
- Delta reconciliation: exactly **-2 tests / -1 file** — the two tests in the deleted `test/boot/sqlite-probe.test.ts`. The `SQLITE_FTS5_MISSING` assertion removed from `test/util/errors.test.ts` was one `expect` line inside an existing test (not its own test), so it does not add to the delta. No other test count changed.
- `npm run typecheck`: clean. `npm run build`: clean. `node_modules/better-sqlite3`: absent. `rg -i 'sqlite|fts5'` over `src/`, `test/`, `docs/`, `package.json`, `package-lock.json`: zero matches (`docs/RFC.md` intentionally out of scope — undecided by the user).

**Verified, not assumed**: `validateBoot()` never called `probeSqlite()` — confirmed by re-grepping `src/boot/validate-boot.ts` before editing. The probe's only planned call site was `src/mcp/server.ts` (task 2.16, not started), so boot ordering is unchanged by this removal.

**ESM-interop coverage (design OD-3) — no replacement test needed**: the probe's test doubled as the P1 CJS-default-import interop smoke on Node 22 LTS. That guarantee survives without a replacement because `src/boot/validate-boot.ts` still default-imports `gray-matter` (a CJS package), and every `validate-boot` test already runs on Node 22 — so NodeNext ESM→CJS default-import interop stays exercised on every suite run.

**Spec status**: the `boot-validation`/`tool-catalog` spec deltas and `openspec/config.yaml` were already amended ahead of this task, on this same branch (`cfb8c6d`, `5653f89`) — no spec/implementation contradiction remains.

## PR-2 (Phase 2, tasks 2.1–2.18) — in-memory index + notes layer + MCP layer

Branch: `add-m1-core/pr2-index-notes` (stacked-to-main), stacked on `add-m1-core/pr1-scaffold-rules-boot`.
Landed across two apply runs: tasks 2.1–2.8 (index + notes layer) first, tasks 2.9–2.18
(MCP catalog/tools/server/serve + P2 phase gate) second. Both are recorded below; Phase 2
is now complete.

### First apply run (tasks 2.1–2.8) — in-memory index + notes layer

Implementation order deliberately followed the module dependency graph (design §1.3: `index →
notes(parse), rules, util`), not task numbering: `notes/parse.ts` (2.6) landed before
`index/build.ts` (2.2), since `build.ts` depends on it.

| Task | Commit | Summary |
|---|---|---|
| 2.1 | `dbbd259` | `IndexedNote`/`QueryFilters`/`FindResultItem` types; the in-memory store — by-id/by-path maps and the forward/backward link graph (wikilinks + `spec_id`), `extractWikilinks`. No I/O. |
| 2.6 | `affc07d` | `notes/parse.ts` — gray-matter parse; `deriveTitle` (heading → frontmatter `title` → filename slug) and `deriveNoteId` (`id_field` → `<type>_id` → `undefined`), shared by save/grammar/index. Implemented ahead of 2.2–2.5 (dependency). |
| 2.2 | `97f9e77` | `index/build.ts` — `buildIndex(vaultPath, rules)` walks only the folders declared per note type in rules.md (never `.memory/`, `conflicts/`, generated `index/`); `resolveNoteType`/`parseNoteAt` exported and reused by 2.3. No index artifact written; restart identity verified. |
| 2.3 | `845dffc` | `index/upsert.ts` — `upsertNote` re-reads one named file and re-parses it (ENOENT ⇒ `removeNote`); `reparseFiles` loops it over git-named changed paths only — unchanged notes are never re-read (proven in tests via object-reference identity). |
| 2.4 | `2c4c128` | `index/queries.ts` — the only store read surface: property filters (type/status/spec_id/owner/tags AND/date-range), free-text (title+body substring scan, applied after filters narrow), `backlinks`, deterministic path-sorted ordering, default limit 20. |
| 2.5 | `f9c38a9` | `index/maps.ts` — `generateIndexMaps`: one `index/<type>.md` per note type present in the store, entries sorted by path, byte-identical across repeated generations. |
| 2.7 | `ea89e1a` | `notes/linked-knowledge.ts` — `appendLinkedKnowledgeEntry`: appends under `## Linked Knowledge` (creates the section if absent), dedupe via an `<!-- linked:<id> -->` marker per entry so repeated saves never duplicate. |
| 2.8 | `f58a7cd` | `notes/save-pipeline.ts` — `saveNote`: validate (against the *merged* frontmatter, not a raw update patch) → render/merge (create = direct serialize; update = shallow frontmatter merge + optional body replace) → pull-before-write via injected `SyncPort` (update only) → write → `index.upsert` → Linked Knowledge maintenance → `SyncPort.notifyWrite` → `{ path, id }`. `createNullSyncPort()` for P2 (real engine lands in P3). |

#### TDD Cycle Evidence (2.1–2.8)

| Task | RED (failing first) | GREEN | Notes |
|---|---|---|---|
| 2.1 | module missing — import failed to resolve | 9/9 | — |
| 2.6 | module missing | 10/10 | — |
| 2.2 | module missing | 7/7 | — |
| 2.3 | module missing | 6/6 | — |
| 2.4 | module missing | 10/10 | — |
| 2.5 | module missing | 5/5 | — |
| 2.7 | module missing | 5/5 | — |
| 2.8 | module missing | 5/5 (after fixing 2 real bugs found mid-cycle, see below) | — |

**Bugs found and fixed during 2.8's cycle** (both caught by the `saveNote — update` test before it went green, not discovered later):
1. Validation was running against the raw `input.frontmatter` (a partial patch on update), spuriously rejecting a note that only patched `status` because the patch alone was missing `spec_id`/`owner`. Fixed by validating the *merged* (final) frontmatter instead — reordered to compute the merge before validating.
2. Id derivation and Linked Knowledge's `spec_id` lookup had the same bug (reading `input.frontmatter` instead of the merged result) — fixed alongside #1 once the merged value was available earlier in the function.
3. A local variable name collision (`frontmatter` re-declared inside `maintainLinkedKnowledgeIfNeeded`, shadowing the parameter of the same name) was caught by the build tool's parser at `npx vitest run`, before any test executed — renamed the inner destructure to `specFile`.

#### Files changed (2.1–2.8)

- Created: `src/index/types.ts`, `src/index/store.ts`, `src/index/build.ts`, `src/index/upsert.ts`, `src/index/queries.ts`, `src/index/maps.ts`, `src/notes/parse.ts`, `src/notes/linked-knowledge.ts`, `src/notes/save-pipeline.ts`
- Created (tests): `test/index/store.test.ts`, `test/index/build.test.ts`, `test/index/upsert.test.ts`, `test/index/queries.test.ts`, `test/index/maps.test.ts`, `test/notes/parse.test.ts`, `test/notes/linked-knowledge.test.ts`, `test/notes/save-pipeline.test.ts`
- Modified: `openspec/changes/add-m1-core/tasks.md` (`[x]` marks + done-notes), this file

#### Deviations / clarifications from design (2.1–2.8)

None of these are scope violations — each resolves an ambiguity between tasks.md's literal task text and design.md's prose, in favor of the more defensive/testable reading:

1. **Where `validateNote` runs.** Design §5.3 describes `mcp/tools/save.ts` (task 2.13, not in this PR) calling `validateNote` before `save-pipeline`; tasks.md 2.8 lists "validate" as save-pipeline's own first step. Implemented `saveNote` to validate itself (defense in depth, standalone-testable) and surface `ValidationIssue[]` verbatim via a discriminated `SaveNoteResult`.
2. **Template rendering is out of save-pipeline's scope.** "Render/merge" (2.8) is implemented as direct frontmatter+body serialization on create and a shallow merge on update — `rules/templates.ts`'s `{{placeholder}}` resolution (next_id counters, author/today resolution) is left to whichever upstream component prepares `frontmatter`/`content` before calling `saveNote` (naturally task 2.13 or CLI tooling, not yet built). No spec scenario requires save-pipeline itself to resolve template placeholders.
3. **Hub type name hardcoded.** Linked Knowledge maintenance treats `"spec"` as the hub type literally, matching consistent RFC/design usage — `NoteTypeDef` has no `isHub`-style flag to derive it from generically.
4. **`index/maps.ts` markdown layout is this task's own design choice** (bullet list per note, `[title](../path) — \`id\` (status)`) — the design says only "sorted, stable formatting"; no literal format is specified anywhere in the RFC/design/specs read for this scope.
5. **A note's id, when its type declares no id field (e.g. `session_log`), falls back to its own vault-relative path** — keeps `IndexedNote.id` always populated (queries/find results always carry an `id`) without inventing an id scheme the rules don't declare.

#### Issues found (2.1–2.8)

None outside the two save-pipeline bugs already caught and fixed within the same TDD cycle (see above) — no known deferred issues from this slice.

### Second apply run (tasks 2.9–2.18) — MCP catalog, tools, server, serve, P2 gate

Same branch (`add-m1-core/pr2-index-notes`), continuing from the first apply run's tip
(`619c14d` at the end of this run). Baseline at the start of this run: `npm test` 240/240
across 33 files.

| Task | Commit | Summary |
|---|---|---|
| 2.9 | `5a4e609` | `mcp/catalog.ts` — pure `buildCatalog(rules)`: exactly six tools, no `project` param; per-type `save` schemas (`saveSchemas`, real required/enum/pattern constraints); descriptions derived from the model. **SDK limitation found and disclosed**: a `z.discriminatedUnion` as a tool's `inputSchema` validates correctly at runtime but renders as an empty JSON schema in `listTools()` (verified against `@modelcontextprotocol/sdk` 1.30.0's `normalizeObjectSchema`, which requires a plain `.shape`). `save`'s *wire* schema is therefore a single flat, permissive object merging every type's fields (`.strict()` on field names only); the true per-type schemas are exposed separately as `saveSchemas` and enforced server-side via `save-pipeline`/`rules/validate.ts`. |
| 2.10 | `576e634` | `mcp/resources.ts` — `rules://current` content (parsed rules + raw template text per type) and `readAgentInstructions` for the server `instructions` field. Reuses `util/paths.ts`'s `templatePathFor`. |
| 2.11 | `c10d65b` | `mcp/tools/find.ts` — property + free-text search via `index/queries.ts`. Added `test/helpers/create-tool-test-client.ts` (real catalog entry + real handler on a real `McpServer`, real SDK `Client` over `InMemoryTransport.createLinkedPair()`), reused by 2.12–2.15. |
| 2.12 | `5f86bc7` | `mcp/tools/read-with-context.ts` — content + frontmatter + backlinks (wikilinks + `spec_id`) + referenced specs' status + 5 most recent linked decisions/incidents (sorted by frontmatter `date`, missing dates sort last). |
| 2.13 | `82db3ef` | `mcp/tools/save.ts` — thin: resolves the target path from the type's folder + naming template + a title-derived slug (the wire schema carries no explicit path field), delegates entirely to `save-pipeline` for validation/write/index-upsert/Linked-Knowledge. Does **not** call `validateNote` a second time (save-pipeline already does, per 2.8's disclosed decision). |
| 2.14 | `794efbe` | `mcp/tools/changes-since.ts` — ISO timestamp → git-log walk → local `note(...)` header parser → classify added/updated/status_changed/removed, deduped to the most-recent state per note (id, or `type::title` when no id) so each affected note appears exactly once. |
| 2.15 | `03ccc5c` | `mcp/tools/status.ts` + `sync.ts` — documented stubs coded against the future `EngineState` shape; only engine-owned fields (`pendingWrites`, `conflicts`, `lastSuccessfulSyncAt`, `pushPaused`, `lockOwner`) are stubbed — `staleNotes`/`formatVersion` are computed for real (index + `rules.lifecycle.staleness` + injected `Clock`). `sync.ts` reuses `status.ts`'s `buildEngineStateStub`. |
| 2.16 | `bfc13fc` | `mcp/server.ts` — split into pure `createServer(deps)` (catalog + six handlers + `rules://current` resource on an `McpServer`, no I/O) and `serveVault(opts)` (`resolveVaultPath` → `validateBoot` → `loadRules` → `buildIndex`+templates+instructions in parallel → `createServer` → `StdioServerTransport`). No lock/engine wiring — P3. `resolveVaultPath`'s original test compared its thrown message against the imported `NO_VAULT_CONFIGURED_MESSAGE` constant — **correction (this claim was wrong until the remediation batch below): that assertion is tautological**, not a byte-exact pin (it would still pass if the constant's value drifted from the spec wording); fixed in the remediation batch (finding 5). |
| 2.17 | `b5f8708` | `cli/commands/serve.ts` — `--vault` flag, never interactive, injectable `serveVault` for testing. Wired `registerServeCommand` into `cli/index.ts`'s `buildProgram()` (necessary for the command to be reachable at all; safety net: `cli/index.ts`'s 11 pre-existing tests stayed green). |
| 2.18 | `619c14d` | P2 phase gate — `test/p2/gate.test.ts`, exercising the *full composed server* (not tools in isolation): exactly six tools with no `project` arg; save-schema enforcement end to end; rules-reload changes behavior with no code change; restart identity with no index artifact ever written; incremental save→find visibility with no restart. |

#### TDD Cycle Evidence (2.9–2.18)

| Task | RED (failing first) | GREEN | Notes |
|---|---|---|---|
| 2.9 | module missing | 7/7 | — |
| 2.10 | module missing | 6/6 | one test-data assumption fixed (a template placeholder name guessed wrong; not a production bug) |
| 2.11 | module missing | 3/3 | implemented production code before the test once (process slip, caught immediately) — reverted to a scratch file, wrote the test, confirmed RED, restored the implementation, confirmed GREEN, disclosed here rather than silently corrected |
| 2.12 | module missing | 3/3 | one test-fixture bug fixed (hand-built `IndexedNote` only set `frontmatter.status`, not the top-level lifted field `build.ts` always populates) — not a production bug |
| 2.13 | module missing | 3/3 | — |
| 2.14 | module missing | 5/5 | one test bug fixed: `git commit` refuses empty commits by default — test commits needed `--allow-empty` since they exist only to exercise log parsing, not real file changes |
| 2.15 | module missing | 3/3 | — |
| 2.16 | module missing | 7/7 | — |
| 2.17 | module missing | 4/4 (+ 1 new test in the pre-existing `cli/index.test.ts`, 16/16 total across both files) | one test assertion bug fixed: `program.parseAsync()` resolves with the `Command` instance, not `undefined` |
| 2.18 | n/a (verification guards over already-implemented code, not new feature code — same category as 1.19/1.20) | 5/5 | caught 2 real test-data bugs on first run (fixture `decision_id` must match `DEC-[0-9]+`, not arbitrary text) — fixed the test, not the implementation; the gate itself never needed a production fix |

#### Files changed (2.9–2.18)

- Created: `src/mcp/catalog.ts`, `src/mcp/resources.ts`, `src/mcp/server.ts`, `src/mcp/tools/find.ts`, `src/mcp/tools/read-with-context.ts`, `src/mcp/tools/save.ts`, `src/mcp/tools/changes-since.ts`, `src/mcp/tools/status.ts`, `src/mcp/tools/sync.ts`, `src/cli/commands/serve.ts`
- Created (tests): `test/mcp/catalog.test.ts` (+ snapshot), `test/mcp/resources.test.ts`, `test/mcp/server.test.ts`, `test/mcp/tools/*.test.ts` (find, read-with-context, save, changes-since, status, sync), `test/helpers/create-tool-test-client.ts`, `test/cli/commands/serve.test.ts`, `test/p2/gate.test.ts`
- Modified: `src/cli/index.ts` (registers `serve`), `test/cli/index.test.ts` (new coverage for the registration), `openspec/changes/add-m1-core/tasks.md` (`[x]` marks + done-notes), this file

#### Deviations / clarifications from design (2.9–2.18)

1. **`save`'s wire-level `inputSchema` is a flat, permissive object, not a `z.discriminatedUnion`** (2.9) — a concrete, verified SDK limitation (see the 2.9 row above), not a design disagreement. The true per-type schemas exist and are enforced; only the `listTools()` JSON-Schema rendering is affected.
2. **`save`'s target path is computed by the tool (2.13), not supplied by the caller** — the wire schema (design §5.2) carries frontmatter + content + optional title only, no path field, so something has to derive it; done deterministically from the type's `folder` + `naming` template + a title slug, reusing the shared `deriveTitle`.
3. **`changes_since` carries its own local commit-header parser** (2.14) rather than importing `src/sync/commit-message.ts`, because that module doesn't exist yet (P3) — tasks.md's own text anticipates this ("unified into `src/sync/commit-message.ts` in 3.2"). P3's wiring task (3.13) is the natural place to fold this parser into the shared grammar module.
4. **`sync`/`status` stubs expose real `staleNotes`/`formatVersion` today**, not placeholder values — only the fields that genuinely require the P3 engine's runtime state are stubbed. This is an enhancement over the minimum "documented stub" bar, not a scope change.

#### Issues found (2.9–2.18)

None outside the process slip on 2.11 (implemented before writing the test) and the handful of test-data/test-fixture bugs listed in the TDD evidence table above — all caught within the same cycle, none shipped, none affecting production code.

## PR-2 remediation batch (fresh-context review fixes)

A fresh-context pre-PR review blocked PR-2 on 2 CRITICAL data-loss defects plus 8
follow-ups (4 WARNING, 4 SUGGESTION). All 10 are fixed on the same branch, each as its
own RED-first work-unit commit (strict TDD; findings 5/8/10 are test-quality/hardening
fixes without new production behavior to describe with a conventional failing test, so
each used the closest equivalent — a demonstrated tautology, a real crash reproduction,
or a strengthened assertion — documented per-finding below). `npm test` (307/307),
`npm run typecheck`, and `npm run build` all pass after every commit in this batch.
Baseline at the start of this batch: `npm test` 287/287 across 41 files.

| # | Severity | Finding | Commit | Fix |
|---|---|---|---|---|
| 1 | CRITICAL | `mcp/tools/save.ts`'s `resolvePath`: a note type with no `naming` template (`incident`, `session_log`) falls back to `folder/<title-slug>.md`, so two different notes sharing a title silently collided — the second save clobbered the first with no error | `5c08b69` | `detectPathConflict` reads the existing file (if any) at the resolved path and compares its derived id against the incoming save's derived id; a mismatch (or no derivable id at all) refuses the write and names the conflicting path. Only a path whose existing note derives the exact same id is treated as an intentional update. Append/union semantics for id-less types (`session_log`) is explicitly a Phase 3 sync question — not solved here. |
| 2 | CRITICAL | `index/store.ts`: two notes deriving the same id desynced `byId`/`byPath` (`byId.size 1`, `byPath.size 2`), and a later `removeNote` on either path could delete the OTHER note's `byId` entry and orphan its back-edges — reachable via a pull landing a duplicate id | `dc5dba9` | `putNote` now rejects a note whose id is already owned by a DIFFERENT path, mutating nothing on rejection. `removeNote` only clears the `byId` slot when it still points at the exact note being removed. `build.ts`/`upsert.ts` needed no changes — both already ignore `putNote`'s return value, so a rejected note is safely skipped rather than corrupting an existing entry; verified with a new `build.ts` regression test (first file wins deterministically, no crash) alongside `store.ts`'s own invariant tests. |
| 3 | WARNING | Seven call sites outside `src/index` read `store.byId` directly (`read-with-context.ts` ×5, `status.ts` ×1, `save-pipeline.ts` ×1), breaking the OD-5 swap seam and making `find.ts`'s own comment ("queries.ts is the only reader") false | `ba365e0` | Added `getNoteById`/`listNotes` to `queries.ts`; routed all seven call sites through them. No behavior change — the existing test suites for all three callers are the safety net. Corrected `find.ts`'s comment now that the invariant genuinely holds (verified with a repo-wide grep: zero remaining violations). |
| 4 | WARNING | `catalog.ts`'s flat wire schema (the SDK workaround from 2.9) merges every type's fields as `z.unknown().optional()`, and `validateNote` only checks the declared type's OWN fields, so `save({type:"decision", decision_id:"DEC-10", actor:"root", incident_id:"INC-99"})` succeeded and wrote foreign fields into the decision's frontmatter | `8708931` | `save.ts` re-parses `args` through `catalog.saveSchemas[type]` — the true, per-type `.strict()` schema — before doing anything else. Normalizes zod issues to the same `{field, message}` shape `ValidationIssue[]` already exposes (so the pre-existing "names the violated field" test needed no changes) and gives the regex validator an explicit message naming the pattern (zod's default "Invalid" doesn't). |
| 5 | WARNING | `test/mcp/server.test.ts`'s `NO_VAULT_CONFIGURED_MESSAGE` assertion compared the thrown message against the imported constant — tautological, would still pass if the constant's value drifted from the spec wording; apply-progress claimed otherwise | `042b4fd` | Added a test asserting the literal string directly. Verified genuinely (not assumed): temporarily mutated the constant's value, confirmed the OLD test still passed (proving the tautology) and the NEW test correctly failed, then reverted the mutation before committing — no `mktemp` needed since the repro was a source-level, not filesystem-level, mutation. Corrected apply-progress's earlier inaccurate claim. |
| 6 | WARNING | `catalog.ts`'s `describeSync` promised "pull, commit pending writes, push" with no hint the P2 handler is a no-op — the stub disclaimer only lived in the response `note` field, which an agent reads AFTER deciding to call the tool | `36e23a6` | Appends `status.ts`'s `ENGINE_STUB_NOTE` (single source of truth, no duplicated wording) to the description itself. Updated the catalog snapshot for this intentional, disclosed change — diff confirmed to touch only the `sync` entry. |
| 7 | SUGGESTION | `save.ts`'s `slugify` strips all non-ASCII, so a CJK-only (or otherwise non-ASCII-only) title produced an empty slug — a type with no naming template wrote a hidden `folder/.md` dotfile, which `build.ts` still indexes | `29c964d` | `resolvePath` falls back to a slugified id when the title's own slug is empty, and refuses the save outright (naming the reason) when BOTH are empty. `detectPathConflict` now takes the already-derived id directly instead of recomputing it. |
| 8 | SUGGESTION | `save-pipeline.ts`'s `mergeNoteContent` (`access`+`readFile`) ran before `validateNote`, so a path escaping the type's declared folder was stat'd and read before being rejected | `1a946ec` | Worse in practice than described: reproduced with a directory sitting just outside the vault — the old ordering made `readFile()` throw `EISDIR` **uncaught** instead of returning a clean validation result. Adds a folder-only pre-check (reusing `validateNote`, filtered to `"folder"` issues) before any filesystem access; the real per-field validation on the merged frontmatter is unchanged and still runs after the write path is confirmed safe. |
| 9 | SUGGESTION | `find.ts`/`changes-since.ts`: `new Date("garbage")` is a truthy Invalid Date, so an unparseable `date_from`/`date_to`/`since` was silently misinterpreted (every comparison against it is `false`) instead of raising an actionable error | `9e6c3e4` | Both tools validate their date argument(s) up front and return a clear `isError` result naming the offending value before building filters / walking git log. |
| 10 | SUGGESTION | `test/p2/gate.test.ts`: the restart-identity test compared two builds of an EMPTY, unmodified vault (both sides trivially `{results: []}`) and never called `read_with_context` though the index spec's scenario names both; the save-schema test asserted only `isError === true`, passing for any failure cause | `f92fe90` | Restart identity now seeds a linked spec+decision, asserts both `find`/`read_with_context` results are non-trivial BEFORE comparing (so an accidental empty result on both sides can't pass vacuously), and compares both across the simulated restart. The save-schema test now pins the specific missing field (`decision_id`) and triangulates with an otherwise-identical save that supplies it. |

### TDD Cycle Evidence — remediation batch

| # | RED (failing first / defect reproduced) | GREEN | Notes |
|---|---|---|---|
| 1 | New tests: second `incident` save with a colliding title returned `isError: undefined` (silently succeeded, overwriting the first) | 6/6 (`save.test.ts`) | — |
| 2 | New `store.test.ts` tests: `putNote` returned `undefined` where `{ok:true}`/`{ok:false}` was expected; the `removeNote` precise-match test found the impostor's removal deleted the real owner's `byId` entry | 13/13 (`store.test.ts`) + 8/8 (`build.test.ts`, bonus regression test) | — |
| 3 | New `queries.test.ts` tests: `getNoteById`/`listNotes` were `is not a function` | 14/14 (`queries.test.ts`); all three callers' pre-existing suites stayed green throughout (behavior-preserving refactor, confirmed via `npm test` before commit) | — |
| 4 | New `save.test.ts` test: a decision save carrying `actor`/`incident_id` returned `isError: undefined` (foreign fields silently written) | 7/7, then 9/9 after finding 7 landed on the same file | Fixing this broke a PRE-EXISTING test (`.field` shape mismatch, zod issues vs `ValidationIssue[]`) — diagnosed and fixed via `toSaveIssues` normalization rather than reverting or weakening the new fix |
| 5 | New `server.test.ts` test: manually mutated `NO_VAULT_CONFIGURED_MESSAGE`'s value, confirmed the OLD test still passed and the NEW literal-string test failed; reverted before implementing (nothing to "implement" — the fix IS the new test) | 8/8 (`server.test.ts`) | Verification-only finding: no production code changed |
| 6 | New `catalog.test.ts` test: `sync` tool description didn't match `/P3/` | 8/8 (`catalog.test.ts`), snapshot updated for the one intentional description change | — |
| 7 | New `save.test.ts` tests: CJK-only incident title produced `incidents/.md`; CJK-only session_log title succeeded and wrote a hidden dotfile | 9/9 (`save.test.ts`) | — |
| 8 | New `save-pipeline.test.ts` test: a directory sitting outside the vault at the traversal path made `saveNote` throw `EISDIR` uncaught instead of resolving `{ok:false}` | 6/6 (`save-pipeline.test.ts`) | Real OS-level repro (an actual directory, not a mock) |
| 9 | New `find.test.ts`/`changes-since.test.ts` tests: an unparseable `date_from`/`since` returned `isError: undefined` | 4/4 (`find.test.ts`) + 6/6 (`changes-since.test.ts`) | — |
| 10 | N/A — test-quality strengthening of already-passing tests, not new production behavior; verified the strengthened assertions actually catch what they claim to (triangulation: an otherwise-identical save WITH the required field must still succeed) | 5/5 (`test/p2/gate.test.ts`) | Caught one test-data bug of my own mid-cycle (`DEC-gate` doesn't match `DEC-[0-9]+`) — fixed the test, not the implementation |

### Process notes (disclosed)

- All fixes landed on the SAME branch (`add-m1-core/pr2-index-notes`) per the
  orchestrator's instruction — no history rewrite (the earlier commit-trailer rewrite
  mentioned in this file's header was already done by the user before this batch
  started; SHAs throughout this file are current).
- No `Co-Authored-By`/`Claude-Session` trailers on any of the 10 remediation commits
  (verified with a `git log` grep scan across the whole batch before reporting).
- Repro artifacts (the temporarily-mutated constant for finding 5, the outside
  directory for finding 8) were either reverted in-place before committing (finding 5)
  or created and torn down entirely within the test itself — a uniquely-named sibling
  directory just outside the vault root, removed via `rm(..., {recursive:true,force:true})`
  in a `finally` block (finding 8) — nothing repro-related was ever committed.

## Remaining tasks

- Phase 3 (3.1–3.14): sync engine + commit grammar + conflict ladder + secrets lint + resolve — PR-3, separate apply run. This also absorbs 2.14's local commit-header parser into `src/sync/commit-message.ts` (3.2) and wires the real `SyncPort`/`IndexPort` into `save-pipeline.ts`/`server.ts` (3.13), replacing the P2 null/stub seams.

## Workload / PR boundary

- PR-1 = Phase 0 + Phase 1 on `add-m1-core/pr1-scaffold-rules-boot`, base `main`. Estimated ~1,850 lines (forecast) — over the 400-line budget by design; authorized by the resolved chained delivery (stacked-to-main), not a size:exception.
- PR-2 (now complete, tasks 2.1–2.18, plus a 10-finding remediation batch) = the in-memory index + notes layer + MCP layer on `add-m1-core/pr2-index-notes`, stacked on PR-1. Forecast was ~1,650 lines; actual is larger (19 files/~1,970 lines for 2.1–2.8 alone, per the orchestrator's independent count, plus the 2.9–2.18 batch and the remediation batch on top) — still authorized under the same chained-delivery decision (stacked-to-main), not a size:exception. PR-2 is feature-complete per its own phase gate (2.18) and has cleared its first fresh-context pre-PR review (2 CRITICAL + 8 follow-up findings, all fixed); only Phase 3 remains before the full M1 scope is done.
- No push, no PR creation, no npm publish (user-owned) — this agent never pushes or opens PRs; the orchestrator handles both.
