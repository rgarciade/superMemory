# Apply Progress — add-project-config

Phase: apply · Chained delivery (stacked-to-main): PR-1 (W1, Phase 1 tasks 1.1–1.3) complete on
`add-project-config/pr1-append-lines`, stacked on `add-m1-core/pr3-sync-engine` (base tip `24fe9cb`
planning commit; the slice's code commits sit on top of it). This run covers **only W1** — the
append-lines extraction + init migration (design AD-5; no behavior change). W2–W5 remain in
separate apply runs on their own stacked branches.

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

## Remaining tasks (later slices, not this run)

- W2 (PR 2): `src/config/project-config.ts` + `makeProjectDir` helper + loader/finder/chain/author tests (tasks 2.1–2.3), stacked on this branch.
- W3 (PR 3): consumer rewiring — serve/sync/resolve (3.1–3.4).
- W4 (PR 4): setup rework + the atomic global-config deletion (4.1–4.6); setup becomes the util's second consumer (`appendMissingLines(root/.gitignore, "supermemory.json\n")`).
- W5 (PR 5): RFC v1.3 + docs sweep (5.1–5.3); Phase 6 final gate (6.1).
