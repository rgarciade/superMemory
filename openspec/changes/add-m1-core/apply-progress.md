# Apply Progress — add-m1-core

Phase: apply (PR-1 slice) · Branch: `add-m1-core/pr1-scaffold-rules-boot` (stacked-to-main)
Scope of this apply run: **Phase 0 (0.1) + Phase 1 (1.1–1.19) only** — the PR-1 work unit of the chained delivery (PR-2 = Phase 2, PR-3 = Phase 3 come in separate runs).

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

## Remaining tasks

- Phase 2 (2.1–2.18): SQLite index + MCP tool catalog — PR-2, separate apply run on a branch stacked on this one.
- Phase 3 (3.1–3.14): sync engine + grammar + ladder + secrets — PR-3, separate apply run.

## Workload / PR boundary

- PR-1 = Phase 0 + Phase 1 on `add-m1-core/pr1-scaffold-rules-boot`, base `main`. Estimated ~1,850 lines (forecast) — over the 400-line budget by design; authorized by the resolved chained delivery (stacked-to-main), not a size:exception.
- No push, no PR creation, no npm publish (user-owned).
