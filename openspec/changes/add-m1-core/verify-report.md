# Verify Report — add-m1-core (M1: Core, dogfood-ready)

Phase: verify · Status: **PASS-WITH-NOTES** · Change: complete (53/53 tasks) · Verification target: `add-m1-core/pr3-sync-engine` HEAD `b5b22a0` (full stacked change: Phase 0 + P1 + P2 + P3)
Inputs: `proposal.md`, five delta specs (`specs/{boot-validation,index,rules-parsing,sync-ladder,tool-catalog}/spec.md`), `design.md`, `tasks.md`, `apply-progress.md`, `openspec/config.yaml` (strict_tdd: true, test_command `vitest run`, build_command `npm run build`, coverage_threshold 0), working tree + test suite at HEAD.

---

## 1. Verdict summary

| Check | Result |
|---|---|
| Process gates: `npm test` (vitest run), `npm run build`, `npm run typecheck` | PASS (test suite green on rerun; see §4 for the disclosed transient flake) |
| Spec coverage (28 requirements / 51 scenarios across 5 capabilities) | PASS — every Requirement and Scenario maps to real implementation + real, passing tests (§5). No phantom coverage found |
| Task completion (53/53) | PASS — commit SHAs in apply-progress/tasks resolve on this branch; spot-checked implementations match their done-notes |
| Strict TDD evidence audit | PASS — all RED/GREEN gaps are honestly disclosed (3.8 reconstructed, 3.9 verification-only, 1.20 deletion-mode Safety Net, 2.11 process slip, gate tasks n/a). **No undisclosed TDD gap found** |
| Assertion quality | PASS with one hardening note — the historic tautology (PR-2 finding 5) was found and fixed by the apply flow itself with mutation verification; no tautologies, ghost loops, type-only-only assertions, or smoke-only gates found in spot checks (CSS assertions N/A — no UI) |
| Review workload / PR boundary | PASS — 3-PR stacked chain exactly as forecast (PR1=P0+P1, PR2=P2, PR3=P3); no `size:exception` claimed or needed (overage authorized by the resolved auto-chain / stacked-to-main decision); PR-3 stayed inside its assigned slice |
| Scope drift vs proposal M1 | NONE — all 143 files vs `main` are in-scope paths; no M2/M3 surface present (no `project` param — tested; no multi-vault, no `theirs_and_archive`, no `.env` loader, no `migrate`). One toolchain note: HEAD `b5b22a0` bumps dev-dep `typescript` 5.9.3 → 7.0.2 — suite/typecheck/build verified green on it during this verification |

**Blockers: none.** Findings below are non-blocking; each has a recommended disposition (§7).

## 2. Verification commands actually run (verbatim results)

| Command | Result (verbatim summary lines) |
|---|---|
| `npm test` (run 1) | `Test Files  2 failed \| 52 passed (54)` / `Tests  2 failed \| 481 passed (483)` — both failures were 5 s timeouts in `test/cli/commands/resolve.test.ts` (real-git tests under 54-way worker parallelism) — **matches the disclosed transient-parallel-flake (attention area 7)**; no assertion failures |
| `npm test` (run 2, rerun per flake protocol) | `Test Files  54 passed (54)` / `Tests  483 passed (483)` / `Duration  38.02s` |
| `npm run build` | exit 0, no output beyond the script banner; `dist/cli/index.js` (shebang preserved), `dist/sync/engine.js`, `dist/cli/commands/{sync,resolve}.js` present |
| `npm run typecheck` | exit 0, clean |
| `npx tsx src/cli/index.ts --version` / `--help` | `0.1.0`; help lists exactly `init`, `setup`, `serve`, `sync`, `resolve` — the M1 command set |

Node: v22.23.2 (engines ≥22 satisfied). Environment: read-only verification; no pushes, no commits, no code fixes performed.

## 3. Task completion spot checks

- Commit SHAs cited in tasks/apply-progress (e.g. `a1fd6be` root, `e91de60` engine, `a007258` scheduler, `dc6127c` resolve, `85d803f`/`55113a7`/`dd1acf5`/`aeda627` slice 3, `48baf9f` SQLite removal) resolve in `git log` on this branch; work-tree clean at verification time.
- Phase gates are real, not formalities: `test/p1/gate.test.ts` (hermeticity guards), `test/p2/gate.test.ts` (composed-server contract tests, hardened per remediation finding 10), `test/p3/gate.test.ts` 8/8 — headline never-delete test asserts local content on disk, remote recoverable from the `conflict/` snapshot branch via `showFile`, conflict note visible with `status: open`, resolve merges/commits/pushes/flips, and a subsequent cycle reports `synced` + `pushed` with empty `conflicts` and `pushPaused=false`. Secrets-blocked is asserted on all four triggers (debounce/interval/CLI/sync-tool). The full M1 loop drives save → real scheduler debounce (fake timers) → engine cycle → bare-remote tip moves → grammar + separate `chore(index)` commits asserted from real `git log`.

## 4. Strict TDD compliance (strict_tdd: true)

`apply-progress.md` contains TDD Cycle Evidence tables for every implementation batch (P1, P1 remediations ×3, 1.20, P2 slices ×2, P2 remediations ×2, PR-3 slices 1–3), with RED evidence, GREEN counts, and mid-cycle findings. Disclosed non-standard cycles, audited and **accepted** per the honesty contract:

| Item | Disclosure | Audit result |
|---|---|---|
| 3.8 engine RED **reconstructed** after two stalled runs | Labeled with provenance + re-verification method (inspected committed 20-test suite against the task's named scenarios, then ran it) | Accepted — the committed `test/sync/engine.test.ts` covers every named scenario (autostash, pull-before-write, skip-clean, backoff, curated/generated/union ladder, separate chore(index), lock report, rules hooks) and passes |
| 3.9 scheduler **verification-only** | Labeled verification, not a TDD cycle; named-coverage audit documented | Accepted — 10 tests re-run green; coverage matches the task line verbatim |
| 1.20 deletion task (no RED possible) | Safety Net mode with exact -2 tests/-1 file delta reconciliation | Accepted — correct discipline for pure deletions |
| 2.11 process slip (impl before test, once) | Disclosed in the evidence table, not hidden | Accepted |
| Gate/verification tasks (1.19, 2.18, finding 5/8/10-style test-quality fixes) | Labeled n/a-RED with rationale | Accepted |

Cross-reference: every test file named in the evidence tables exists and passes at HEAD. **No undisclosed RED/GREEN gap found.**

## 5. Requirement/Scenario coverage (all files named; all verified passing)

### boot-validation (2 R / 5 S) — impl `src/boot/validate-boot.ts`, `src/util/errors.ts`, `src/config/global-config.ts`
- R1 Boot-time vault validation (3 S) — `test/boot/validate-boot.test.ts`: valid vault passes all five (l.34); one negative fixture per check (l.46–102, incl. inside-app-repo guard l.81 + realpath/symlink/case hardening l.124–163); first-failure-only ordering (l.164). ✔
- R2 Fail-fast actionable errors (2 S) — check-3 error points at vault init (l.66); byte-exact `No vault configured. Run: supermemory setup` via `test/mcp/server.test.ts` l.54 + the literal (non-tautological) pin l.72. ✔

### index (4 R / 5 S) — impl `src/index/{build,store,upsert,queries}.ts`
- R1 In-memory at boot, no artifact (1 S) — `test/index/build.test.ts` l.101 (git status clean) + `test/p2/gate.test.ts` l.206. ✔
- R2 Properties/full-text/link graph (1 S) — `test/index/queries.test.ts` (filters l.25/41/75, free text l.103, backlinks l.177). ✔
- R3 No durable state, restart identity (1 S) — build.test.ts l.116; p2 gate l.206 (find **and** read_with_context, non-vacuous). ✔
- R4 Incremental without rebuild (2 S) — `test/index/upsert.test.ts` l.40 (immediately visible), l.169 (only named files re-read, proven by object identity); pulled-changes reparse via `test/sync/engine.test.ts` l.346. ✔

### rules-parsing (4 R / 10 S) — impl `src/rules/{parser,templates,validate,version}.ts`
- R1 v1 parsing (2 S) — `test/rules/parser.test.ts` l.19/30/56 (complete model), l.97 (located `RULES_PARSE_ERROR`), l.90 (no partial model). ✔
- R2 Template rendering (2 S) — `test/rules/templates.test.ts` l.15 (all placeholders), l.32/37 (interpolation only). ✔
- R3 Note validation (3 S) — `test/rules/validate.test.ts` l.38 (missing field named), l.59/95/105 (pattern/naming/folder each identified), l.33 (conforming passes). ✔
- R4 format_version contract (3 S) — `test/rules/version.test.ts` l.12/16 (same-major accepted), l.20 (higher-major refused, actionable); sync-changed-rules via the engine pre-pull guard — `test/sync/engine.test.ts` l.529 (skip pull, keep pending, refuse, report). See attention area 1 for the live-server nuance. ✔

### tool-catalog (7 R / 11 S) — impl `src/mcp/{catalog,server}.ts`, `src/mcp/tools/*`, `src/notes/*`
- R1 Six tools, no `project` (1 S) — `test/mcp/catalog.test.ts` l.30/37; `test/p2/gate.test.ts` l.65. ✔
- R2 Schemas/descriptions from rules (2 S) — catalog.test.ts l.48 (per-type required/types/enums), l.88 (`.strict()`), l.103 (reload changes schemas, no code change), l.137 (descriptions embed declared rules); p2 gate l.93/139. Live-server hot-swap nuance → attention area 1. ✔
- R3 `find` (2 S) — `test/mcp/tools/find.test.ts` l.37 (property filter, results carry id/title/status/path), l.65 (free text). ✔
- R4 `read_with_context` (1 S) — `test/mcp/tools/read-with-context.test.ts` l.54/112 (backlinks, referenced-spec status, recent linked). ✔
- R5 `save` (2 S) — `test/mcp/tools/save.test.ts` l.75 (rejection names violated rule, writes nothing), l.272 (Linked Knowledge, no duplicates). ✔
- R6 `changes_since` (1 S) — `test/mcp/tools/changes-since.test.ts` l.40 (each note exactly once, correct classification). ✔
- R7 `sync`/`status` (2 S) — `test/mcp/tools/sync.test.ts` l.24 (real cycle + post status; blocked writes surfaced per 3.14 fix), `test/mcp/tools/status.test.ts` l.25 (engine state verbatim incl. pending/conflicts/stale/format version); engine/state tests. ✔

### sync-ladder (11 R / 20 S) — impl `src/sync/*`, `src/cli/commands/{sync,resolve}.ts`
- R1 Auto triggers (2 S) — `test/sync/scheduler.test.ts` (trailing-edge debounce l.41/53, interval l.104, production timers under fake timers l.164); skip-clean interval `test/sync/engine.test.ts` l.394. ✔
- R2 Manual trigger (1 S) — `test/cli/commands/sync.test.ts` (one cycle, outcome report); gate CLI test `test/p3/gate.test.ts` l.270. ✔
- R3 Pull-rebase + pull-before-write (2 S) — `test/sync/git.test.ts` l.105; engine.test.ts l.296 (autostash survival), l.346 (pull-before-write). ✔
- R4 Commit grammar (3 S) — `test/sync/commit-message.test.ts` l.32 (exact `note(add)` header), l.106 (status transition), l.189 (byte-identical determinism); engine commits l.200/255/276. ✔
- R5 Human authorship + trailers (1 S) — git.test.ts l.59 (`%an`), l.~90s trailers via `%(trailers)`; engine.test.ts l.200; commit-message.test.ts l.144/172 (Author/Via/Spec, omission order). ✔
- R6 Index regen separate commits (1 S) — engine.test.ts l.461; gate M1 loop asserts `note(add)` and a distinct `chore(index): regenerate maps` from real git log. ✔
- R7 Conflict ladder (4 S) — `test/sync/ladder.test.ts` (classification/routing l.26–122; union both-regions l.131; sorted/dedup normalizer l.172–224); engine.test.ts l.413 (curated: abort+snapshot+note+pause), l.461 (generated, no human), l.495 (union + normalization commit); `test/sync/resolve.test.ts` l.261 (guided resolve completes). ✔
- R8 Never silently delete (1 S) — `test/p3/gate.test.ts` headline l.155–220 (local intact + snapshot recoverable + resolve); resolve.test.ts l.261 settles local side pinned at git level. ✔
- R9 Secrets lint before every commit (2 S) — gate l.225/250/270/304 (all four triggers); lint verified wired at every commit-creating stage (`src/sync/engine.ts` l.328/379 writes, l.696 normalization, l.703 chore(index), `src/sync/resolve.ts` l.186 finalize, `src/sync/conflict-note.ts`); `test/sync/secrets.test.ts` 28 tests incl. 11 high-precision negatives. ✔
- R10 Single sync owner (1 S) — `test/sync/lock.test.ts` 13 tests (single-owner/refusal/stale-reclaim/release-reacquire/`currentHolder`); gate l.359 (server-vs-CLI, CLI mutates nothing), l.389 (stale reclaim); engine.test.ts l.168. Per-cycle semantics → attention area 2. ✔
- R11 Safety & hygiene (2 S) — git.test.ts l.168 (pull args pinned, no force flag reachable), engine backoff-without-loss tests; `test/sync/state.test.ts` l.93 (status keeps last success). ✔

## 6. The seven attention areas — explicit verdicts

1. **§3.1 rules-refused server reaction (tool gating + hot catalog rebuild) — DISCLOSED DEVIATION, ACCEPTABLE.** Verified unwired: `src/mcp/server.ts:238` `onRulesReloaded` only swaps `currentRules` (index port + tunables follow); zero references to rules-refused gating in `src/mcp/tools/`/`catalog.ts`; the "rules reload" tests rebuild the server rather than hot-swap a live one. **Not spec-violating for M1**: the rules-parsing R4 S3 scenario ("a sync pulls a rules.md change…") is fully guarded upstream by the engine's pre-pull guard (unsupported remote rules are never pulled — the strongest form of refusal; tested), and `status`/push-pause do reflect refusals. Honestly disclosed in apply-progress slice-3 deviation #2 as open work. Recommended follow-up (WARNING, before heavy dogfooding): wire per-tool-call refusal gating + catalog re-registration so a *locally* hand-edited unsupported rules.md cannot leave tools validating against a stale boot-time catalog.
2. **§4.5 lock held per cycle, not per process lifetime — DISCLOSED DEVIATION, ACCEPTABLE.** Verified in `src/sync/engine.ts` (acquire at l.748/782, release in `finally`). The spec's invariant ("two sync engines MUST NEVER race") and scenario hold: the lock serializes all git mutation, CLI-during-a-cycle reports ownership (tested), stale locks are reclaimed (tested). Design §4.5's stronger "boot-and-hold" wording is unimplemented, with a sound technical reason disclosed (the engine's own release would rewrite/delete a boot-held lock). No spec scenario requires ownership between cycles.
3. **Stale `index/<type>.md` when a note type is deleted from rules — GAP, UNDISCLOSED (WARNING, non-blocking).** Verified: `generateIndexMaps` (`src/index/maps.ts`) emits maps only for types present in the store, and `createVaultIndexPort.regenerateMaps` (`src/mcp/server.ts:148`) writes only changed files — it never deletes `index/<type>.md` for a type removed from rules, so the obsolete map stays committed. **Not a violation of any named spec scenario** (no requirement or scenario covers map deletion; the chore(index) N-count scenario still holds), but the edge is disclosed nowhere in apply-progress/tasks — flagging per the honesty contract. Low blast radius (derived, human-facing file only). Recommended: one-line disclosure at archive + a future deletion pass for obsolete maps.
4. **Conflict-note flip is disk-only, rides next cycle — DISCLOSED DEVIATION, ACCEPTABLE.** Verified end to end: resolve's flip is disk-only; the engine reconciles its tracker from the durable record (`refreshConflictsFromDisk`, `src/sync/engine.ts:195–230`) each cycle/pull — without this a resolved conflict paused pushes forever (the gap the P3 gate caught, fixed RED-first in 3.14). The gate asserts the full sequence: resolve commits **and pushes** the resolution, then the next cycle reports `synced`/`pushed` with `conflicts: []` and `pushPaused=false`. Note for the record: the live server's `status` may still report the conflict until its next cycle (bounded by debounce/interval) because the CLI resolve runs in its own process — the spec scenario's substance (resolution committed+pushed; status no longer reports it) is met; immediacy is not. Disclosed in slice-2 disclosure #1 and the engine source comment.
5. **TDD honesty for 3.8/3.9 — ACCEPTED (properly disclosed).** See §4. Both carry explicit provenance labels in the TDD Cycle Evidence table with a defensible re-verification method; the committed tests exist, match their named scenarios, and pass at HEAD.
6. **Resolve finalize pulls before committing — DISCLOSED DEVIATION, ACCEPTABLE.** Verified: without the pull, the push after a curated abort is rejected non-fast-forward, so the spec's "resolution is committed and pushed" could never succeed. The local side is settled via the replayed local commit during rebase and pinned by reading it back from git history (`test/sync/resolve.test.ts` l.261+); the incoming side remains recoverable from the retained snapshot branch — never-silently-delete holds; the observable commit order still matches design §4.4.
7. **Transient parallel flake — REPRODUCED ONCE, GREEN ON RERUN (LOW).** Run 1 of this verification hit exactly the disclosed mode: 2 failures, both 5 s timeouts in `test/cli/commands/resolve.test.ts` real-git tests under full parallel isolation; run 2 (and the apply flow's own consecutive green runs) fully green. No assertion failure ever observed. Suggested hardening (non-blocking): raise `testTimeout` for real-git suites or reduce worker isolation for the slowest files.

## 7. Findings register (non-blocking; no remediation performed by this phase)

| # | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| 1 | WARNING | `src/index/maps.ts` / `src/mcp/server.ts` (`createVaultIndexPort`) | Obsolete `index/<type>.md` is never deleted when a type is removed from rules; undisclosed in artifacts | Disclose at archive; future deletion pass (attention area 3) |
| 2 | WARNING | `src/mcp/server.ts`, `src/mcp/tools/*` | rules-refused per-tool-call gating + hot catalog re-registration unwired (disclosed as open work) | Follow-up change before heavy dogfooding (attention area 1) |
| 3 | LOW | `test/cli/commands/resolve.test.ts` | 5 s default timeout on real-git tests flakes under full parallel load (reproduced once) | Timeout/isolation hardening (attention area 7) |
| 4 | INFO | commit `b5b22a0` | dev-dep `typescript` 5.9.3 → 7.0.2 landed after implementation commits, superseding apply-progress deviation #5; verified green (suite ×2 incl. this verification, typecheck, build) | Record in apply-progress at archive; no action needed |
| 5 | INFO | apply-progress (slice-2/3) | `status` clears a resolved conflict only from the next cycle on the live server (disclosed design order) | Accepted; optional M2 nicety: reconcile on resolve completion |

## 8. Review workload / PR boundary

- Forecast honored: chained PRs (recommended: Yes) executed as PR-1 (`add-m1-core/pr1-scaffold-rules-boot`, P0+P1) → PR-2 (`add-m1-core/pr2-index-notes`, P2) → PR-3 (`add-m1-core/pr3-sync-engine`, P3), stacked-to-main per the resolved auto-chain decision. PR-1 and PR-2 delivered (PR #1 open per apply-progress); PR-3 complete at `b5b22a0` and is this verification's target containing the full stack.
- No `size:exception` was claimed anywhere; every over-budget phase is explicitly recorded as authorized by the chain decision (tasks.md forecast + apply-progress "Workload / PR boundary"). PR-2's actual size exceeding forecast is recorded honestly.
- PR-3 boundary respected: the branch contains exactly Phase 3's assigned slice; no P1/P2 rework beyond the PR-scoped remediation batches recorded in apply-progress.

## 9. Archive readiness

**Ready.** All dependencies for archive are met (verify: ready; report now present). No destructive deltas are included (the only deletions — SQLite probe, TROUBLESHOOTING doc, P2 stub surface — are rollback of this same change's own scaffolding, already reviewed and tested). Findings 1–5 above are recommended follow-ups, not archive blockers; per the native contract, neither this report nor task completion blocks or admits archive by itself.
