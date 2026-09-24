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

## W4 slice (PR 4) — setup rework + the atomic global-config deletion (Phase 4 tasks 4.1–4.6)

Run on `add-project-config/pr4-setup-rework` (stacked on W3 tip `32f29bf`). Delivery:
`auto-chain` / `stacked-to-main` (session-resolved; not re-decided). Strict TDD active
(`openspec/config.yaml`: `strict_tdd: true`, `vitest run`). Scope honored: Phase 4 ONLY —
no RFC/docs edits (W5) and no engine changes (AD-7 held: `git.ts`/`engine.ts` have zero
diff on this branch).

### Completed tasks

| Task | Commit | Summary |
|---|---|---|
| 4.1 | `e4c9186` | RED (guards): `test/cli/commands/setup.test.ts` rewritten for `runSetup(prompts, { basePath, homeDir })` — `envWith(configDir)` and every global-config assertion deleted; fixtures are `makeProjectDir` project repos + a local `makeVault` helper (separate `simpleGit` repo + `.memory/rules.md`, current style); `scriptedPort` kept. New pins: home-root refusal FIRST (the fixture is `git init`ed, pinning the home-as-dotfiles-repo ordering), non-work-tree refusal (plain tmp dir), real project passes guards, refusals write nothing (no `supermemory.json`/example, pre-placed `.gitignore` byte-unchanged), `SETUP_LOCATION_REFUSED` code + the two pinned message/hint templates byte-exact with the launch dir interpolated, guards before any prompt (`asked.vaultPath === 0`). Surviving loop tests re-signed; `~` expansion now asserts against the INJECTED home (no `process.env.HOME` mutation anywhere). |
| 4.2 | `c02ad78` | GREEN (guards): `src/util/errors.ts` gains `SETUP_LOCATION_REFUSED` (one code added, none removed — the `ERROR_CODES` registry pin in `test/util/errors.test.ts` enumerates it in the same commit); `src/cli/commands/setup.ts` takes `io: { basePath, homeDir }` (`env: EnvSource` param dropped), guards in the only order that refuses home-as-repo, pinned bytes verbatim from design AD-2; setup's private `resolveVaultPath(raw)` renamed `expandVaultInput(raw, homeDir)` (AD-6 collision fix; home injected, not ambient). Commander action injects `{ basePath: process.cwd(), homeDir: os.homedir() }`. The global-config merge-write already died here — its `env` param was the coupling; the project-file writes land in 4.4 (commented in-source). |
| 4.3 | `1927187` | RED (writes): the writes-contract suite — subdir invocation writes all three artifacts at the WORK-TREE ROOT (AD-2 × AD-1; nothing at the launch subdir; `result.root` pinned); fresh-write rerun kills stale keys with the serialization contract byte-exact (flat shape, 2-space indent, trailing newline, vault-first/author-second); author defaults from `readGitIdentity(vault)` (accepting defaults writes it); gitignore appended-when-missing (`node_modules/` byte-unchanged), idempotent across a second run (exactly one line), CRLF preserved (N7 port, Buffer compare); example file created-when-absent with exactly `EXAMPLE_CONFIG_CONTENT` (no author substring anywhere) and never overwritten (pre-placed committed example byte-identical); `MAX_VAULT_ATTEMPTS = 5` abort leaves zero artifacts; confirm message pinned `Write supermemory.json in {root} (vault {vault}, author "{name}" <{email}>)?` with no wizard string naming any other config surface; legacy hint (AD-4): `legacyConfigPath` set from the INJECTED home iff `~/.config/supermemory/config.json` exists, file never read (`/LEAK/` payload absent from the written project file), never deleted, absent ⇒ undefined; `setupCompletionLines` pins the one-line iff-present log bytes. `scriptedPort` now records every prompt message and consumes confirm answers in order. |
| 4.4 | `8411793` | GREEN (writes + commander edge): all writes at `findProjectRoot(basePath)`; `SetupResult { root, vault, author, legacyConfigPath? }`; one `existsSync` legacy probe under the injected home right after the guards; `setupCompletionLines(result)` emits the completion line + EXACTLY ONE pinned legacy line iff present; `registerSetupCommand` gains the injectable `SetupRunner` (W3 register-suite discipline) with the action as the ONE ambient edge owning the completion log (PromptPort flow: the wizard never logs). No user-visible string in `src/` says "global config" except the disclosed AD-4 hint line. |
| 4.5 | `049a7be` | THE DELETION (atomic): `src/config/global-config.ts` + `test/config/global-config.test.ts` deleted; `ENV_KEYS` loses the config-dir entry (vault/logLevel/syncIntervalMinutes/debounceSeconds survive); `withTestEnv` loses `configDir` (vault only); the env-restore coverage keeps `SUPERMEMORY_VAULT`; the `ENV_KEYS` pin now asserts the dead knob must NOT come back; the p1 gate's global-config scenario deleted (hermeticity job inherited by the project-dir fixture tests). Grep gate over `src/` + `test/`: `SUPERMEMORY_CONFIG_DIR`, `loadGlobalConfig`, `saveGlobalConfig`, `configDirFor`, `resolveDefaultVault`, `authorFromConfig` → **zero hits**. User data under `~/.config/supermemory` never touched on disk. |
| 4.6 | (gate, no commit) | W4 slice gate — all green, see verification below. Gate-only task: no diff of its own; the docs commit records it (W1/W2/W3 precedent). |

### TDD Cycle Evidence (strict_tdd)

| Task | RED (failing first, observed) | GREEN | REFACTOR |
|---|---|---|---|
| 4.1 | `npx vitest run test/cli/commands/setup.test.ts` → **5 failed \| 2 passed** vs the old env-based wizard: refusal tests get `BOOT_VALIDATION_FAILED` + 5 vault prompts (guards missing), the global-config merge-write leaks (`TypeError: env.get is not a function` at `global-config.ts:19`), `~` expands against the REAL home (`/Users/raul.garciad/my-vault`). Type-level RED: **8 findings** (`basePath` absent from the old `EnvSource` param) — W3 precedent, resolved by 4.2 | focused 7/7; full suite 527/527 | guards precede every prompt/IO; the dead merge-write block removed with a pointer to 4.4 |
| 4.3 | `npx vitest run test/cli/commands/setup.test.ts` → **11 failed \| 10 passed** vs the post-4.2 wizard: every new-behavior pin fails (old impl writes nothing, confirm still names the global config, `SetupResult` lacks `root`/`legacyConfigPath`, `setupCompletionLines` export absent). Type-level RED: **3 findings** (`root`/`legacyConfigPath` absent from `SetupResult`) — resolved by 4.4 | focused 23/23 (21 + the 2 register-edge pins); full suite 543/543; typecheck + build clean | conditional-spreads kept verbatim — they ARE the design §4.3-pinned serialization expression; `writeIfAbsent` is wx + `isEexist` tolerance (init.ts pattern), no existsSync pre-check (the flag is both check and enforcement) |
| 4.4 | — (implementation lands against the red suite) | focused 23/23; full 543/543 | register-edge pins landed WITH the seam (see deviations) |
| 4.5 | — (deletion task: no new behavior; driven by the grep gate + suite-green contract) | full run 1: 6 transient sync-area failures (known parallel-git flake lineage; modules untouched by the commit); instructed single rerun: **55 files / 535 tests, all green** | unused `mkdtemp` import dropped from `gate.test.ts`; grep-gate literals reworded out of comments (the 4.6 gate wants zero hits) |
| 4.6 | — | gate: full `vitest run` **twice consecutively green (535/535 × 2)**; `npm run typecheck` + `npm run build` clean; diff vs `add-project-config/pr3-consumer-rewiring` confined to the 11 W4 files | — (gate) |

### Files changed (W4 slice)

- Modified: `src/cli/commands/setup.ts` (rework: guards, expandVaultInput, writes, legacy hint, SetupRunner edge), `src/config/env.ts` (−configDir), `src/util/errors.ts` (+1 code)
- Deleted: `src/config/global-config.ts`, `test/config/global-config.test.ts`
- Modified (tests): `test/cli/commands/setup.test.ts` (rewrite + extension), `test/util/errors.test.ts` (registry pin), `test/config/env.test.ts`, `test/helpers/env.ts`, `test/helpers/env.test.ts`, `test/p1/gate.test.ts`
- Docs: `openspec/changes/add-project-config/tasks.md` (4.1–4.6 ticked), this file

### Verification evidence (task 4.6 slice gate)

- `npx vitest run` → **55 files / 535 tests, all passing, twice consecutively** (run 1 at 4.5 showed 6 transient sync-area failures — the known parallel-git flake lineage from W3's notes; the instructed single rerun was green, and both gate runs are green; sync/engine, sync/git, sync/resolve suites all pass focused and in the gate runs. W1 init pins untouched-green; W3 server/sync/resolve migration untouched-green).
- `npm run typecheck` → clean. `npm run build` → clean.
- §4 pinned bytes asserted byte-exact in the suite: SETUP_LOCATION_REFUSED ×2 (message + hint), example content (`EXAMPLE_CONFIG_CONTENT`), serialization (2-space indent + trailing newline), confirm message, legacy hint line (em-dash included).
- Grep gates: the six dead symbols → zero hits in `src/` + `test/`; "global config" in `src/` user-visible strings only in the AD-4 hint line (disclosed); no engine diff (`git.ts`/`engine.ts` untouched).
- `git diff add-project-config/pr3-consumer-rewiring --stat` → confined to the 11 W4 files listed above. Five conventional commits (`e4c9186`, `c02ad78`, `1927187`, `8411793`, `049a7be`) + this docs commit; nothing pushed (maintainer-owned delivery); `main` untouched.
- **Review-budget variance (reported, not self-excepted):** forecast ~530 gross (rework ~230 + rewrite ~300, cohesive unit, deletion ~−250 net) → measured cumulative branch churn **1,262 gross (847+/415−, net +432)**. Two honest accounting notes: (a) the forecast counted the slice's final content, while RED→GREEN on a fully rewritten test file double-counts churn (4.1 replaced the old file, 4.3/4.4 extended it — per-task stats: +182/−160, +66/−29, +399/−9, +202/−17, +20/−164); (b) the final files are `setup.ts` 307 lines + `setup.test.ts` ~940 (21 runSetup pins + 2 register pins), and the enumerated spec scenarios (guards, writes, gitignore N7 trio, example pair, abort, legacy pair) are inherently verbose. One honest slicing pass already ran at tasks time (W1–W5 seams); the documented split point is after task 4.2 (guards) — decision deferred to review per the chained-pr rule; **no `size:exception` claimed**.

### Notes & deviations (W4)

- **The merge-write died at 4.2, not 4.5 (forced by the pinned signature).** Task 4.2 drops the `env: EnvSource` param, and `loadGlobalConfig`/`saveGlobalConfig` cannot compile without it — so the LAST USE of global-config died in 4.2 (inside the "4.2–4.4" window tasks.md itself names), while the module + its tests stayed green until 4.5 deleted them atomically with the knob trims. This honors the sequencing note's intent (module dies in the same slice as its last consumer) without a transient ambient `ProcessEnvSource` hack.
- **Register-edge pins landed with the seam in 4.4.** The old `registerSetupCommand` had no injectable runner; driving it RED would have run @inquirer against a non-TTY stdin (hang risk in an unattended run). The bytes those tests assert were RED-pinned in 4.3 via `setupCompletionLines`; the 4.4 pins cover the ambient-edge injection (`process.cwd()`/`os.homedir()`) and the exactly-one-legacy-line wiring, mirroring the W3 register-suite discipline.
- **Transient full-run flake (honest report).** The first post-deletion full run showed 6 failures in `test/sync/engine.test.ts` / `sync/git.test.ts` / `sync/resolve.test.ts` — modules this commit never touched; the instructed single rerun was green, then the gate ran green twice consecutively. Lineage matches the parallel-git flake recorded at W3.
- **`ERROR_CODES` registry ripple in 4.2's commit:** the exhaustive registry pin required the new code the same commit (spec mandates one code added, none removed). Same category as W3's input ripples.
- Stale `--vault` help text in sync/resolve ("overrides SUPERMEMORY_VAULT / vaults.default") remains deliberately untouched — W5 docs sweep, per the W3 note.

## W5 slice (PR 5) — RFC v1.3 + docs sweep (Phase 5 tasks 5.1–5.3)

Run on `add-project-config/pr5-rfc-docs` (stacked on W4 tip `5b63067`). Delivery:
`auto-chain` / `stacked-to-main` (session-resolved; not re-decided). Scope honored:
Phase 5 ONLY — docs + the one sanctioned help-text touch; no engine or behavior
changes. Strict TDD is inapplicable to this slice by its own definition (docs-only
work unit; the sanctioned touch is a user-facing string reword with no pinning
test — grep over `test/` confirmed zero pins before editing, so nothing to update;
verification is the gate evidence below).

### Completed tasks

| Task | Commit | Summary |
|---|---|---|
| 5.1 | `87d7f75` | The 15-location RFC edit plan executed as ONE atomic docs commit (`docs(rfc): v1.3 — per-project supermemory.json replaces the global config`, 80+/60−): (1) header → `Draft v1.3 (per-project supermemory.json replaces the global config; legacy .memory/local.json superseded)`; (2) §1 "tiny global config of pointers" → "tiny per-project config file"; (3) §3 diagram — the `~/.config/supermem/config.json` box replaced by `AGENT PROJECT / supermemory.json / (gitignored) / vault pointer + author identity`, arrow reversed to "MCP reads at boot from the nearest work-tree root" (VAULT/Git-remote boxes preserved byte-for-byte, shifted down 3 lines for the taller config box); (4) invariant 2 reworded to "writes exactly: the gitignored `supermemory.json` (plus the optional committed `supermemory.example.json` and one `.gitignore` line) inside the agent project, and logs"; (5) §4.1 `local.json` layout line deleted (tree stays valid); (6) §5.1 re-anchored — `<path\|name>` → `<path>`, multi-vault marked M2 re-anchored on per-project files ("there is no global registry"), `vault add` records in the project's `supermemory.json`, `projects_list`/`vault_register` rows marked *(M2 design intent)*; (7) §6.3 author clause → "(from the project config's `author`, falling back to inherited Git identity)" verbatim with the sync-ladder delta; (8) §7.2 walkthrough rewritten (run INSIDE the agent project; guards refusing $HOME/non-work-tree before any prompt; vault re-prompted until boot validation passes with 5-invalid-attempt abort writing nothing; author defaults from the vault repo's git config; the three artifacts — gitignored config + example-when-absent + idempotent gitignore line; `install --client`/`vault add` marked M2, "same global config" wording gone; never-interactive/pinned-error paragraph kept verbatim); (9) §7.5 → "The per-project `supermemory.json` survives updates (it lives in the project)… `npx supermemory@latest` remains a complete update"; (10) §8 chain → "`serve --vault <path>` serves exactly one vault; `serve --multi` (M2)… With no flag: `SUPERMEMORY_VAULT` env → `supermemory.json` at the nearest Git work-tree root of the launch directory"; (11) §8 jsonc pair — gitignored flat `supermemory.json` (vault + author) + committed `supermemory.example.json` (placeholder `"/absolute/path/to/your/vault"`, never author — matches `EXAMPLE_CONFIG_CONTENT` bytes); (12) `SUPERMEMORY_CONFIG_DIR` table row deleted; (13) never-implemented `~/.config/supermemory/.env` loading sentence dropped, vault `config.yml` + source-repo `.env` dogfooding note kept; (14) §10 verify-only — "outside §3's two exceptions" still tracks the reworded invariant (config artifacts + logs = two exceptions); NO change; (15) §12 verify-only — M1 bullet stays true; NO change. Anchors were re-located by grep (RFC drifted a few lines vs the v1.2 capture; content matched everywhere — intent adapted, anchors re-verified before each edit). Archived change docs untouched. |
| 5.2 | (verification-only, no commit) | Sweep executed; **no README/docs changes found beyond 5.1's RFC commit**: `docs/` contains only `RFC.md` (plus this change's own openspec artifacts); `README.md` is a 7-line stub pointing at the RFC with zero config-mechanism language, no onboarding flow to fix, no `SUPERMEMORY_CONFIG_DIR`/`vaults.default`/`local.json`-as-plan occurrences; post-edit grep over `docs/` + `README.md` shows only the sanctioned v1.3 header supersession note and the §5.1 "no global registry" negation. Task 5.2's own conditional ("its own commit **if changes are found**") resolves to no commit; evidence recorded here per the W1–W4 gate-task precedent. Cleanup/rollback note verified present via §7.2 (delete `supermemory.json` + drop one gitignore line is the inverse of the three-artifact write set). |
| (sanctioned touch) | `d1d239a` | The W3/W4-deferred stale `--vault` help text fix (`fix(cli)`, 4+/4−): `"vault path or configured name (overrides SUPERMEMORY_VAULT / vaults.default)"` → `"vault path (overrides SUPERMEMORY_VAULT / the project's supermemory.json)"` in sync.ts + resolve.ts **and serve.ts** — serve carried the identical stale string plus a stale chain comment (`flag → SUPERMEMORY_VAULT → vaults.default`); the W3 sweep note had listed only sync/resolve. No test pins these strings (zero hits in `test/`), so no test updates. See deviations. |
| 5.3 | (gate, no commit) | W5 slice gate — all green, see verification below. Gate-only task: the docs commit records it (W1–W4 precedent). |

### Files changed (W5 slice)

- Modified: `docs/RFC.md` (80+/60− — the 15-location plan), `src/cli/commands/sync.ts`, `src/cli/commands/resolve.ts`, `src/cli/commands/serve.ts` (1 line each, sanctioned help-text reword)
- Docs: `openspec/changes/add-project-config/tasks.md` (5.1–5.3 ticked), this file

### Verification evidence (task 5.3 slice gate)

- **Diff confinement**: `git diff add-project-config/pr4-setup-rework --stat` → exactly `docs/RFC.md` (140 lines) + the three 1-line cli help files (6 lines total) — docs-only except the sanctioned touch; openspec docs ride in this metadata commit per chain convention.
- **Grep gates**: `SUPERMEMORY_CONFIG_DIR` over `src/`, `test/`, `docs/`, `README.md` → **zero hits**; `vaults.default` / "configured name" over the same surface → **zero hits** (the deleted mechanism has no remaining reference in code, tests, or docs); "global config" in `src/` only in the AD-4 pinned legacy hint (disclosed design exception) and negating comments — unchanged from the W4 gate state.
- **One chain story**: RFC §3 diagram (MCP reads `supermemory.json` at boot from the nearest work-tree root), §8 chain (flag → env → project file), and invariant 2 (writes the three artifacts inside the agent project) all describe the same `resolveVaultPath`/`findProjectRoot` implementation; §6.3's author clause matches the sync-ladder delta verbatim.
- `npx vitest run` → run 1: 5 failures in `test/cli/commands/resolve.test.ts` (1) + `test/sync/resolve.test.ts` (4) — the known parallel-git flake lineage (W3/W4 notes); focused rerun of the two suites **18/18 green**, then the instructed single full rerun: **55 files / 535 tests, all passing**.
- `npm run typecheck` → clean. `npm run build` → clean.
- Review budget: slice churn **164 gross (84+/80−)** vs ~180 forecast — inside; lowest-risk slice in the chain.
- Branch `add-project-config/pr5-rfc-docs`; conventional commits `87d7f75` (docs) + `d1d239a` (fix) + this docs commit; nothing pushed (maintainer-owned delivery); `main` untouched.

### Notes & deviations (W5)

- **serve.ts joined the sanctioned touch (disclosed scope addition).** The parent instruction and W3 note named sync.ts/resolve.ts; the grep before editing found the *identical* stale string and a stale chain comment in serve.ts's `--vault` option. Leaving it would have kept a `vaults.default` reference alive in the very surface the 5.3 gate greps and contradicted the change's success criteria ("no user-visible 'global config' mechanism strings anywhere in code"). Included as the same one-line reword; disclosed here for the reviewer. Net: 3 files, +4/−4.
- **Anchor drift handled per instruction.** Design's line numbers were captured at RFC v1.2; the file had drifted slightly (e.g. §7.2 block actually at ~485-497, §5.1 at ~341). Every anchor's current wording was read and verified before editing; where the plan's shorthand and reality differed (e.g. §5.1's `<path|name>` → `<path>` ripple into the launch sentence), intent was preserved and adapted, never broadened.
- **Diagram restructure note.** The new AGENT PROJECT box is 2 content lines taller than the old global-config box, so the VAULT/Git-remote column shifted down 3 lines; both boxes' inner rows are byte-preserved from the original. The MCP→config arrowhead reversed (`◀`) to read "config flows into MCP" with the boot-time discovery label stacked in the gutter.
- **Task 5.2 produced no commit** — its own wording makes the commit conditional on findings; the sweep is evidenced above. This mirrors the W1–W4 "gate tasks carry no empty commit" convention.
- **535/535 sanity holds at the W5 tip** — the docs slice changed no behavior (help strings + markdown only), matching the parent's expectation for the Phase 6 final gate.
