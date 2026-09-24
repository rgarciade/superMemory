# Apply Progress — add-project-config

Phase: apply · Chained delivery (stacked-to-main): PR-1 (W1, Phase 1 tasks 1.1–1.3) complete on
`add-project-config/pr1-append-lines`, stacked on `add-m1-core/pr3-sync-engine` (base tip `24fe9cb`
planning commit; the slice's code commits sit on top of it); PR-2 (W2, Phase 2 tasks 2.1–2.3)
complete on `add-project-config/pr2-project-config`, stacked on the W1 tip `be6243c`. W3–W5 remain
in separate apply runs on their own stacked branches.

Session delivery resolution: `auto-chain` / `stacked-to-main` (resolved before this phase; not
re-decided here). Strict TDD active (`openspec/config.yaml`: `strict_tdd: true`, `vitest run`).

## Completed tasks

| Task | Commit | Summary |
|---|---|---|
| 1.1 | `cc44c40` | RED: `test/util/append-lines.test.ts` (new, 8 tests) — the init N7 regression suite ported to the util contract `appendMissingLines(filePath, content): Promise<AppendLinesResult>` (`{ changed: boolean; original: Buffer \| null }`). Scenarios: absent file ⇒ created with exactly `content`, `original: null` · idempotent no-op ⇒ `{ changed: false, original: pre-bytes }`, provably no write (mtime pinned) · partial presence appends only missing lines · CRLF preservation for appended lines (N7) · negation re-append (`!line` last ⇒ treated as missing) · negation triangulation (positive last ⇒ no-op) · raw non-UTF-8 byte (0xE9) survives — raw Buffer compare, never decoded · existing lines never modified/reordered, EOL separator inserted when the file lacks a trailing newline. Hermetic: `mkdtemp(os.tmpdir())` per test, no chdir, no env mutation. |
| 1.2 | `9cf637c` | GREEN + REFACTOR: `src/util/append-lines.ts` (new) — `appendMissingLines` is init.ts's `mergeMissingLines` body moved **verbatim** minus the `ScaffoldTracker` coupling (the util captures `original` itself and returns it); the five byte-level helpers (`splitLinesRaw`, `trimLineRaw`, `isAsciiBlank`, `bufferEndsWith`, `isEffectivelyPresentRaw`) move with it — grep confirmed no other module used them. `src/cli/commands/init.ts`: `mergeMissingLines(filePath, content, tracker)` is now a thin wrapper (call the util; track `{ path, original }`; return `changed`); both call sites (`init.ts` `.gitignore`/`.gitattributes`) untouched; the now-unused `readFile` import dropped; `init.ts` no longer contains the algorithm body. |
| 1.3 | (gate, no commit) | W1 slice gate — all green, see verification below. Gate-only task: produces no diff, so no empty commit; the slice's conventional commits are `cc44c40` + `9cf637c`, and this docs commit records the gate. |

## TDD Cycle Evidence (strict_tdd)

| Task | RED (failing first, observed) | GREEN | REFACTOR |
|---|---|---|---|
| 1.1 | `npx vitest run test/util/append-lines.test.ts` → suite fails to load: `Error: Cannot find module '../../src/util/append-lines.js'` — 1 failed suite, no tests ran (module intentionally absent) | — | — |
| 1.2 | — (implementation lands against the red suite) | focused: 8/8 in `test/util/append-lines.test.ts`; full suite: **491/491 across 55 files**, init N7 + rollback pins passing **unchanged** (byte-identical behavior = the acceptance criterion) | init.ts reduced to the thin wrapper; algorithm lives only in the util; typecheck + build clean after the refactor |

## Files changed (W1 slice)

- Created: `src/util/append-lines.ts` (~130 lines incl. AD-5 doc contract), `test/util/append-lines.test.ts` (160 lines)
- Modified: `src/cli/commands/init.ts` (−100 algorithm lines → +34 wrapper/import lines)
- Docs: `openspec/changes/add-project-config/tasks.md` (1.1–1.3 ticked), this file (new)

## Verification evidence (task 1.3 slice gate)

- `npx vitest run` → **55 files / 491 tests, all passing** (twice during the cycle: after GREEN and post-refactor; init pins untouched).
- `npm run typecheck` → clean. `npm run build` → clean.
- `git diff add-m1-core/pr3-sync-engine --stat` → confined to `src/cli/commands/init.ts`, `src/util/append-lines.ts`, `test/util/append-lines.test.ts` + the openspec docs (`tasks.md`, `apply-progress.md`) — exactly the W1 file set; no other module imports the util yet (independently landable).
- Churn: 294 additions + 100 deletions ≈ 394 changed lines, inside the 400-line review budget.
- Branch `add-project-config/pr1-append-lines`; nothing pushed (maintainer-owned delivery); `main` untouched.

## Notes & deviations

- **Wrapper tracking semantics (intentional reading of AD-5's shorthand).** AD-5 sketches the
  wrapper as "if `original !== null` push `{ path, original }`". Implemented literally that would
  break pinned behavior: `rollbackScaffold` deletes `mergedFiles` entries whose `original` is
  `undefined` ("created fresh by this call"), and `test/cli/commands/init.test.ts`'s
  "fully created-and-rolled-back scaffold leaves no trace" requires exactly that for an
  init-created `.gitignore`/`.gitattributes`. `ScaffoldTracker.mergedFiles` also declares
  `Buffer | undefined`, so `null` wouldn't typecheck. The wrapper therefore **always** pushes,
  mapping the util's `null` → `undefined` — byte-identical to pre-extraction behavior, which is
  the design's own acceptance gate ("N7 pins pass UNCHANGED").
- **RED commit precedent.** Task 1.1's conventional commit (`cc44c40`) contains the test suite in
  its observed-RED state (import of the not-yet-existing module), per the one-commit-per-task
  instruction; the next commit (`9cf637c`) greens it. Both commits documented accordingly.
- No test was modified to make it pass; no existing test file changed in this slice.

## W2 slice (PR 2) — project-config module (Phase 2 tasks 2.1–2.3)

Run on `add-project-config/pr2-project-config` (stacked on W1 tip `be6243c`). Delivery:
`auto-chain` / `stacked-to-main` (session-resolved; not re-decided). Strict TDD active
(`openspec/config.yaml`: `strict_tdd: true`, `vitest run`). Scope honored: **no consumer
rewiring** — `server.ts`/`setup.ts` keep their old copies; only the tests import the new module
(that isolation is the slice's point).

### Completed tasks

| Task | Commit | Summary |
|---|---|---|
| 2.1 | `dea09fb` | RED: `test/helpers/project.ts` (new) — `makeProjectDir({ config?, example?, gitignore?, nested? })` → `{ root, subdir?, cleanup() }`: `mkdtemp(os.tmpdir())` + bare `git init` (the `.git` marker discovery needs it), optional pre-placed `supermemory.json` (via the module's `PROJECT_CONFIG_FILENAME` constant), example/gitignore bytes, recursive subdir. Plus `test/config/project-config.test.ts` (new, 29 tests) — the full RED suite: loader fail-safe matrix (absent · unreadable chmod 000 · invalid JSON `{ "vault": ` · non-object roots string/number/null/array · vault missing · non-string · relative `"../vaults/notes"` · author half-present dropped with vault honored · unknown keys ignored · happy path) · `findProjectRoot` (at root · from subdir · nested work trees nearest-wins · no `.git` anywhere → undefined · `.git` as a FILE = linked-worktree shape) · `projectConfigPath` (join / outside → undefined) · `projectAuthor` (both · absent/undefined · malformed one-of/empty/non-object → undefined) · `resolveVaultPath` chain (flag>env>file · env>file · file last · nothing → AppError `NO_VAULT_CONFIGURED` with the byte-pinned message + hint naming `--vault` and `SUPERMEMORY_VAULT` · corrupt file fails safe to the same pinned error · relative vault treated as unconfigured) · `EXAMPLE_CONFIG_CONTENT` byte pin (placeholder, no author anywhere). Hermetic: stub `EnvSource`, no `process.env` mutation, no chdir, no HOME writes, no network (local `git init` only, under the suite's git-env isolation). |
| 2.2 | `8ce0100` | GREEN + REFACTOR: `src/config/project-config.ts` (new, 163 lines) per design AD-6 signature block — `PROJECT_CONFIG_FILENAME`/`EXAMPLE_CONFIG_FILENAME`/`EXAMPLE_CONFIG_CONTENT` (pinned bytes), `ProjectConfig` (flat), `findProjectRoot` (pure-fs `statSync` walk, `.git` dir OR file, nearest-root-only, per-level try/catch), `projectConfigPath`, `loadProjectConfig` (fail-safe, never throws for content), `projectAuthor` (structurally typed — no `sync/` import), `resolveVaultPath({ vaultFlag, env, basePath })` reusing `NO_VAULT_CONFIGURED_MESSAGE` from `util/errors.ts`. REFACTOR: author validation shared once (`parseOptionalAuthor`) between loader and `projectAuthor` (no duplication); the loader's return collapsed from conditional-spread to a plain ternary; imports only node builtins + `config/env.js` (`EnvSource`, `ENV_KEYS`, `readString`) + `util/errors.js`; zero ambient reads — no `process.cwd()`/`os.homedir()`/`process.env` anywhere in the module. |
| 2.3 | (gate, no commit) | W2 slice gate — all green, see verification below. Gate-only task: no code diff of its own; the docs commit records it (W1 precedent — no empty commit). |

### TDD Cycle Evidence (strict_tdd)

| Task | RED (failing first, observed) | GREEN | REFACTOR |
|---|---|---|---|
| 2.1 | `npx vitest run test/config/project-config.test.ts` → suite fails to load: `Error: Cannot find module '../../src/config/project-config.js' imported from test/config/project-config.test.ts` — 1 failed suite, 0 tests ran (module intentionally absent) | — | — |
| 2.2 | — (implementation lands against the red suite) | focused: 40/40 (`project-config.test.ts` + 3 existing helper test files); full suite: **56 files / 520 tests, all passing** (491 pre-existing untouched + 29 new) | author validation deduplicated into `parseOptionalAuthor`; conditional-spread → ternary; re-ran full suite + typecheck + build after the refactor — all clean |
| 2.3 | — | — | — (gate) |

### Files changed (W2 slice)

- Created: `src/config/project-config.ts` (163 lines), `test/helpers/project.ts` (76 lines), `test/config/project-config.test.ts` (396 lines)
- Docs: `openspec/changes/add-project-config/tasks.md` (2.1–2.3 ticked), this file

### Verification evidence (task 2.3 slice gate)

- `npx vitest run` → **56 files / 520 tests, all passing** (ran twice: post-GREEN and post-refactor; existing suite untouched — `server.ts`/`setup.ts` still own their old copies).
- `npm run typecheck` → clean. `npm run build` → clean.
- `git diff add-project-config/pr1-append-lines --stat` → confined to `src/config/project-config.ts`, `test/helpers/project.ts`, `test/config/project-config.test.ts` (task text says "two new files"; three is correct — helper + test + module) + the openspec docs from this docs commit. No other module imports the new one (independently landable/revertible).
- Branch `add-project-config/pr2-project-config`; conventional commits `dea09fb` (test, RED) + `8ce0100` (feat, GREEN). Nothing pushed (maintainer-owned delivery); `main` untouched.
- **Review-budget variance (reported, not self-excepted):** forecast ~350 → actual **635 gross lines, additions-only** (module 163 ≈ forecast 150; helper 76 ≈ 60; test matrix 396 vs ~140 forecast — the 29 enumerated scenarios are inherently verbose). One honest slicing pass already ran at tasks time (W1–W5 seams); suite + module are one TDD work unit, so no cohesive further split exists without dropping enumerated spec coverage. Decision deferred to review per the chained-pr rule (accept, or split the PR boundary at review time); no `size:exception` claimed.

### Notes & deviations (W2)

- **RED commit precedent (W1 convention).** Task 2.1's commit (`dea09fb`) contains the helper + suite in their observed-RED state (imports of the not-yet-existing module); commit `8ce0100` greens them.
- **Hint-tier static-analysis advisories in the module (accepted, justified):** `no-runtime-typeof` ×2 and `no-unsafe-dictionary-unknown` ×2 flag the loader's runtime `typeof` checks and `Record<string, unknown>` indexing on `JSON.parse` output — that runtime validation of untrusted file content is the fail-safe loader's spec-mandated job ("MUST NOT crash with a parse error, MUST NOT partially honor a malformed file"). No 🔴 findings; typecheck + build clean.
- **`path.resolve` in `findProjectRoot`** normalizes `basePath` so the `dirname` walk terminates on every input; for the absolute paths the seam rule guarantees (commander edges inject `process.cwd()` — W3), it is a pure operation. The module still contains no ambient reads.
- The module's `NO_VAULT_CONFIGURED` hint wording was refreshed to name both escape hatches (`--vault` / `SUPERMEMORY_VAULT`) per design §4 and to drop the old "default vault" global-config language; the byte-pinned **message** is asserted verbatim by the tests.

## Remaining tasks (later slices, not these runs)

- W3 (PR 3): consumer rewiring — serve/sync/resolve (3.1–3.4), stacked on this branch.
- W4 (PR 4): setup rework + the atomic global-config deletion (4.1–4.6); setup becomes the util's second consumer (`appendMissingLines(root/.gitignore, "supermemory.json\n")`).
- W5 (PR 5): RFC v1.3 + docs sweep (5.1–5.3); Phase 6 final gate (6.1).

## W3 slice (PR 3) — consumer rewiring: serve/sync/resolve (Phase 3 tasks 3.1–3.4)

Run on `add-project-config/pr3-consumer-rewiring` (stacked on W2 tip `8553330`). Delivery:
`auto-chain` / `stacked-to-main` (session-resolved; not re-decided). Strict TDD active.
**Interruption note:** this slice was interrupted mid-flight after task 3.1's RED commit
(`49def8a`) with an incomplete uncommitted `sync.test.ts` edit (its `makeProjectDir` import was
still unused); the RESUME run reviewed that edit — kept everything that served the 3.3 RED
contract (required-`basePath` runner inputs, ambient-cwd commander pin) and completed it with the
two missing author-seam tests before any commit. Tasks 3.2/3.3 source work was untouched at
resume.

### Completed tasks

| Task | Commit | Summary |
|---|---|---|
| 3.1 | `49def8a` | RED (pre-interruption): `test/mcp/server.test.ts` migrated — imports `resolveVaultPath`/`loadProjectConfig`/`projectAuthor` from `config/project-config.js`; `SUPERMEMORY_CONFIG_DIR` dropped from `fakeEnv`; global-config fallback tests became project-file tests (`makeProjectDir`) plus the subdir-launch case (AD-1 discovery through the chain); unconfigured tests use an empty tmp dir + `fakeEnv({})`; **the byte-exact literal pin stays verbatim** (`"No vault configured. Run: supermemory setup"` — only fixture + import changed, comment documents the history); `authorFromConfig` tests deleted (superseded by W2 `projectAuthor` unit tests). Observed RED: 1 failed \| 11 passed (the serveVault boot test fails against the old `server.ts`). |
| 3.3 (RED) | `ff0ee1f` | RED: `test/cli/commands/sync.test.ts` completed + `test/cli/commands/resolve.test.ts` — runner inputs gain REQUIRED `basePath` (5 sync + 3 resolve call sites + `SyncCommandInput`/`ResolveCommandInput` contract pinned at the type level); commander action pinned as the one ambient edge (`process.cwd()`) in both register suites; TWO author-seam tests added to sync (with-author ⇒ both engine commits carry the project author; **the degradation case** — project file without `author` ⇒ commits inherit the vault's local Git identity, hermetic via `vaultFlag` + `basePath: project.root` so ambient `SUPERMEMORY_VAULT` can never decide). Observed RED: 4 failed \| 15 passed — and the failures demonstrate the old global-config leak (commits carried the developer's `~/.config/supermemory` identity instead of the project file's). |
| 3.2 (GREEN) | `9f23e0a` | GREEN: `src/mcp/server.ts` — `resolveVaultPath` + `authorFromConfig` + the `global-config` import deleted, **no re-export shim**; `ServeOptions.basePath?` (defaults to `process.cwd()` inside `serveVault` — the documented non-commander edge, AD-6); chain via `resolveVaultPath({ vaultFlag, env, basePath })`; `author = projectAuthor(await loadProjectConfig(basePath))`; `createVaultSyncStack` flow unchanged; `ENV_KEYS`/`readString`/`AppError`/`NO_VAULT_CONFIGURED_MESSAGE` imports trimmed with the dead code. Transition: server.test.ts 1F/11P → **12/12**. |
| 3.3 (GREEN) | `4f1094d` | GREEN: `src/cli/commands/sync.ts` + `src/cli/commands/resolve.ts` — `basePath: string` REQUIRED on both inputs; commander actions inject `process.cwd()`; imports swap to `config/project-config.js` (the `mcp/server` inverted dependency dies — only the sanctioned shared `createVaultSyncStack` import remains in sync.ts); `runResolve({ …, author })` flow unchanged; `runResolve`'s author is computed inline per AD-7. Ripple: `test/p3/gate.test.ts` call sites gain `basePath: vault.root` (inputs-only; assertions unchanged — the vault work tree has no `supermemory.json`, so the author degrades to inherited identity). Transitions: sync+resolve 4F/15P → **19/19**; all 8 RED type findings green. |
| 3.4 | (gate, no commit) | W3 slice gate — all green, see verification below. Gate-only task: the docs commit records it (W1/W2 precedent). |

### TDD Cycle Evidence (strict_tdd)

| Task | RED (failing first, observed) | GREEN | REFACTOR |
|---|---|---|---|
| 3.1 | (pre-interruption, `49def8a`) `test/mcp/server.test.ts` focused: 1 failed \| 11 passed — `serveVault` boot test fails against the old in-file resolver (no `basePath` option, global-config fallback) | — | — |
| 3.3 RED | `npx vitest run test/cli/commands/sync.test.ts test/cli/commands/resolve.test.ts` → **4 failed \| 15 passed**: sync ambient-cwd (`basePath` undefined vs `process.cwd()`), sync with-author + degradation (old global-config path committed with the developer's personal identity — the leak the change kills), resolve ambient-cwd. Type-level RED: `basePath` absent from both input interfaces (8 tsc findings) | — | — |
| 3.2 | — (implementation lands against the red `server.test.ts`) | focused: **12/12** in `test/mcp/server.test.ts` | dead imports trimmed with the deleted functions; no shim left |
| 3.3 GREEN | — (implementation lands against the red CLI suites) | focused: **19/19** across sync + resolve suites; `test/p3/gate.test.ts` **8/8** | — (inputs-only ripple in gate.test.ts) |
| 3.4 | — | full `npx vitest run`: **56 files / 526 tests, all passing**; `tsc --noEmit` clean | — (gate) |

### Files changed (W3 slice)

- Modified: `src/mcp/server.ts` (−old resolver/author helpers, +basePath edge), `src/cli/commands/sync.ts`, `src/cli/commands/resolve.ts` (required `basePath`, import swaps)
- Modified: `test/mcp/server.test.ts` (migration), `test/cli/commands/sync.test.ts`, `test/cli/commands/resolve.test.ts` (RED contracts + author-seam cases), `test/p3/gate.test.ts` (4 input-ripple sites)
- Docs: `openspec/changes/add-project-config/tasks.md` (3.1–3.4 ticked), this file

### Verification evidence (task 3.4 slice gate)

- `npx vitest run` → **56 files / 526 tests, all passing** (520 at W2 tip + 6 net new/renumbered).
- `npm run typecheck` → clean. `npm run build` → clean.
- `git diff add-project-config/pr2-project-config -- src/sync/engine.ts src/sync/git.ts` → **empty** (AD-7 honored: the author seam is the same injected dep, only the source swapped).
- `src/config/global-config.ts` still present and green (`test/config/global-config.test.ts` inside the 526; sole remaining consumer `setup.ts` untouched — W4 deletes module + consumer atomically).
- Diff confined to the seven W3 files + openspec docs; four conventional commits on the branch (`49def8a`, `ff0ee1f`, `9f23e0a`, `4f1094d`); nothing pushed; `main` untouched.
- **Review-budget variance (reported, not self-excepted):** forecast ~240 → actual **465 gross** (359 + 106; server.test.ts migration 177 and sync/resolve test contracts 143 dominate — test churn pinned by the tasks' enumerated scenarios). The slice boundary 3.1–3.4 is one cohesive rewiring (RED commits precede both GREENs; splitting would strand one side of the deleted exports). No further honest split exists; per W2 precedent the decision is deferred to review; no `size:exception` claimed.

### Notes & deviations (W3)

- **Commit order vs task numbering (deliberate, TDD-honest).** The 3.3 RED commit (`ff0ee1f`) precedes the 3.2 GREEN commit (`9f23e0a`): a behavioral RED must be observed against the pre-rewiring source, and 3.2 deletes the shared exports `sync.ts`/`resolve.ts` import — after it lands, CLI suites can only fail as module errors, not honest behavioral REDs (AD-6 forbids re-export shims that would paper over this). Consequence, documented: the tree at `9f23e0a` transiently breaks the sync/resolve suites (imports of removed exports); the slice's PR boundary is the whole W3 range, where everything is green (526/526).
- **Degradation-test hermeticity choice.** The author-seam tests pass `vaultFlag: vault.root` AND `basePath: project.root`: resolution is pinned hermetically (ambient `SUPERMEMORY_VAULT` can never decide, honoring the seam rule — no env mutation), while the author lookup still flows through the project file exactly as the sync-ladder delta scenarios specify. Flag-less project-file resolution is pinned where it belongs: the chain unit tests (W2) and the serveVault boot tests (3.1).
- **`--vault` option help text** in sync.ts/resolve.ts still says "(overrides SUPERMEMORY_VAULT / vaults.default)" — stale global-config wording, deliberately untouched in W3 (minimal-diff scope); flagged for the W5 docs sweep alongside README/docs.
- The full run passed first try (no rerun needed; the known transient-parallel-flake lineage did not fire).
