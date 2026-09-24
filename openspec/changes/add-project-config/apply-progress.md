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
