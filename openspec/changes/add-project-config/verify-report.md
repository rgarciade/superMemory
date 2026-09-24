# Verify Report — add-project-config (per-project `supermemory.json` replaces the global config)

Phase: verify · Status: **PASS-WITH-NOTES** · Change: complete (21/21 tasks) · Verification target: `add-project-config/pr5-rfc-docs` HEAD `ba5cf6b` — the full stacked chain pr1←`add-m1-core/pr3-sync-engine`(24fe9cb) → pr2 → pr3 → pr4 → pr5, **including** the gate hardening `ef42710` and the disclosed post-gate setup tab-completion (`dcd1a7c`+`ba5cf6b`) that extend the branch past the parent-cited `2c5000b` (all disclosed in apply-progress; verified through actual HEAD).
Inputs: `proposal.md` (R1–R5), three delta specs (`specs/{project-config,boot-validation,sync-ladder}/spec.md` — 9 R / 25 S total), `design.md` (AD-1…AD-7 + §7 RFC edit plan), `tasks.md` (21/21 ticked), `apply-progress.md` (5 slice records + Phase 6 gate + hardening + post-gate UX), `openspec/config.yaml` (strict_tdd: true, vitest), archived `add-m1-core` verify-report (format precedent). Working tree clean at verification time (only the pre-existing, disclosed untracked `.DS_Store`/`.idea/`).

---

## 1. Verdict summary

| Check | Result |
| --- | --- |
| Process gates: `npm test` (vitest run), `npm run typecheck`, `npm run build` | PASS — full suite green **first try, no rerun needed** (56 files / 548 tests; the post-hardening timeout fix holds); typecheck exit 0; build exit 0 |
| Spec coverage (9 R / 25 S: project-config 7 R / 21 S + two MODIFIED deltas 1 R / 2 S each) | PASS — every Requirement and Scenario maps to real implementation + real, passing, discriminating tests (§5). No phantom coverage found |
| Task completion (21/21) | PASS — every commit SHA cited in apply-progress resolves in `git log` (RED commits `cc44c40`, `dea09fb`, `49def8a`, `ff0ee1f`, `e4c9186`, `1927187`, `93d1d33` all present with observed-RED subjects); per-slice diffs re-measured and match the recorded churn; branch ancestry pr1←base…pr5←pr4 all ancestor-YES |
| Strict TDD evidence audit (strict_tdd: true) | PASS — all cycles honestly disclosed; **no undisclosed TDD gap found** (§4) |
| Assertion quality | PASS — no tautologies, ghost loops, type-only-only assertions, or smoke-only gates in the new/changed suites; the historic tautology class is explicitly defended by a non-tautological literal pin; one informational note (§6) |
| Review workload / PR boundary | PASS-WITH-NOTES — 5-branch stacked chain exactly as the tasks forecast (`stacked-to-main`, pr1 targeting `add-m1-core/pr3-sync-engine`); each slice confined to its disclosed files; **no `size:exception` claimed**; W2 and W4 exceed the 400-line budget with honest, deferred-to-review accounting (Notes 1–2, §8) |
| Scope drift vs proposal R1–R5 | NONE — all five requirements implemented as specified; project RULES shows **zero implementation surface** (§7); out-of-scope items (migration tooling, multi-vault, `.memory/local.json`, RULES) all absent |
| RFC v1.3 coherence | PASS — the 15-location edit plan landed as one atomic commit (`87d7f75`); §3 diagram, §3 invariant 2, and §8 chain tell **one** story; §6.3 author clause verbatim with the sync-ladder delta; zero competing-chain references remain (§9) |

**Blockers: none.** Notes below are non-blocking; each has a recommended disposition (§10).

## 2. Verification commands actually run (verbatim results)

| Command | Result (verbatim summary lines) |
| --- | --- |
| `npm test` (run 1 — no rerun required) | ` Test Files  56 passed (56)` / `      Tests  548 passed (548)` / `   Start at  16:37:00` / `   Duration  45.53s` — plus the one registered benign stderr line `error: missing required argument 'value'` (attention area 9; deterministic, documented in apply-progress Phase 6; reproduced here exactly as disclosed). The `ef42710` timeout hardening holds under a real 56-worker parallel run: zero failures, zero timeouts |
| `npm run typecheck` | exit 0, clean (`tsc --noEmit`) |
| `npm run build` | exit 0, clean; `dist/cli/index.js` produced (gitignored — tree stayed clean) |
| CLI smoke: `node dist/cli/index.js --version` | `0.1.0`, exit 0 |
| CLI smoke: `node dist/cli/index.js setup --help` | wizard surface renders (`Usage: supermemory setup [options]` + one-time-wizard description), exit 0 |
| CLI smoke: unconfigured boot — `sync` and `resolve` in a fresh mktemp dir, `SUPERMEMORY_VAULT` unset | both exit 1 with the **pinned error verbatim**: `supermemory: [NO_VAULT_CONFIGURED] No vault configured. Run: supermemory setup` + hint naming `--vault`/`SUPERMEMORY_VAULT`. Real `~/.config/supermemory` and every real vault untouched (tmp-dir smoke only) |
| CLI smoke: `setup` in a non-work-tree tmp dir | exit 1, `supermemory setup must run inside a Git work tree (/private/tmp/… is not one)…` — the AD-2 pinned message with the actual dir interpolated; directory verified **empty afterward** (refusal wrote nothing) |
| CLI smoke (positive discriminator): git repo + `supermemory.json` at root, `sync` launched from a **subdirectory** | exit 1 with `BOOT_VALIDATION_FAILED … vault "<path-from-the-project-file>" is not a git repository.` — proves the compiled chain walked up (AD-1), read the project file, and fed its vault to boot validation (error class changed from `NO_VAULT_CONFIGURED`) |
| Branch topology | `git merge-base --is-ancestor` pr1←base, pr2←pr1, pr3←pr2, pr4←pr3, pr5←pr4: all YES; `merge-base(base, pr1) = 24fe9cb` = base tip (task 0.1 condition holds against the real tip, per the disclosed stale-hash note) |

Node: engines ≥22 satisfied. Environment: read-only verification — no commits, no pushes, no code fixes; the only file written by this phase is this report.

## 3. Task completion spot checks

- All cited SHAs resolve: W1 `cc44c40`/`9cf637c` → tip `be6243c`; W2 `dea09fb`/`8ce0100` → `8553330`; W3 `49def8a`/`ff0ee1f`/`9f23e0a`/`4f1094d` → `32f29bf`; W4 `e4c9186`/`c02ad78`/`1927187`/`8411793`/`049a7be` → `5b63067`; W5 `87d7f75`/`d1d239a` → `2c5000b`; Phase 6 `93d1d33`/`ef42710` → `dcd1a7c`/`ba5cf6b` (HEAD).
- Slice diff gates independently re-measured (openspec docs excluded): pr1 294+/100− (3 files); pr2 **635+** (3 files); pr3 359+/106− (7 files); pr4 847+/415− (**11 files**); pr5 564+/69− (16 files — RFC + help rewords + p6 tests + the disclosed UX addition). `git diff` over `src/sync/engine.ts`+`src/sync/git.ts` from pr2 through pr4: **0 lines** (AD-7 held — the author seam is the same injected dep).
- Implementations match their done-notes: `src/config/project-config.ts` implements AD-1/AD-6 exactly (pure-fs `.git` dir-or-file walk, nearest-root-only, fail-safe loader collapsing every malformed shape to `undefined`, flat `ProjectConfig`, structural `projectAuthor`, the frozen chain with `NO_VAULT_CONFIGURED_MESSAGE`); zero ambient reads in the module. `src/cli/commands/setup.ts` implements AD-2/3/4/5 exactly: home-root guard FIRST (refuses home-as-git-repo), then work-tree guard, both with the AD-2 pinned message/hint bytes and the launch dir interpolated; `MAX_VAULT_ATTEMPTS = 5`; fresh-write serialization `JSON.stringify({ vault, …author }, null, 2) + "\n"`; `appendMissingLines` for the one gitignore line; `wx`+`isEexist` example create; AD-4 legacy probe under the **injected** home surfaced via `SetupResult` + exactly-one-line `setupCompletionLines`; `expandVaultInput` rename done; commander edge owns ambient `process.cwd()`/`os.homedir()`. `src/mcp/server.ts`, `sync.ts`, `resolve.ts` all consume the shared chain with required/optional `basePath` as designed; no re-export shims; the `mcp/server` inverted dependency from CLI commands is gone. `src/config/global-config.ts` **deleted**; `ENV_KEYS` has no `configDir`.
- Dead-symbol grep gate re-run over `src/`+`test/`: `SUPERMEMORY_CONFIG_DIR`, `loadGlobalConfig`, `saveGlobalConfig`, `configDirFor`, `resolveDefaultVault`, `authorFromConfig` → **zero hits**. `SUPERMEMORY_CONFIG_DIR` also zero in `docs/`+`README.md`.

## 4. Strict TDD compliance (strict_tdd: true)

`apply-progress.md` carries TDD Cycle Evidence tables for every slice (W1–W4 + the Phase-6 acceptance additions), with observed-RED evidence and GREEN counts. Audit results:

| Item | Disclosure | Audit result |
| --- | --- | --- |
| RED-first commits | One conventional commit per task; test-first commits land in their observed-RED state (import-fail REDs for W1/W2; behavioral REDs for W3/W4) | **Verified real** — all seven RED commits exist; e.g. `ff0ee1f`'s 4F/15P demonstration of the global-config identity leak is a genuine behavioral RED, and `1927187`'s 11F/10P pins the writes contract against the pre-write wizard |
| W3 interruption + resume | Disclosed: slice interrupted after 3.1's RED with an incomplete `sync.test.ts` edit; resume reviewed/kept what served 3.3 and completed it before committing | Accepted — honest, and the completed tests are present and passing |
| 6.1 retracted double-green + hardening | Disclosed: the original double-green was invalidated by parent verification (load-dependent 5000ms-boundary timeouts); `ef42710` adds `vi.setConfig({ testTimeout: 20_000 })` to the seven git-heavy suites; pre-hardening claim explicitly retracted in apply-progress | Accepted — `git show ef42710 --stat` confirms **7 test files, +25/−4, zero production code**; this verification's own full run (first-try 548/548, 45.5s, 56 workers) confirms the hardening holds |
| Budget variances (W2 635 vs ~350; W3 465 vs ~240; W4 1,262 vs ~530) | Disclosed per slice with per-task accounting; RED→GREEN double-count on the rewritten `setup.test.ts` explained; split point after 4.2 documented; no `size:exception` claimed | Accepted as honest — re-measured churn matches the disclosures exactly (§3); the over-budget disposition is correctly deferred to review (Notes 1–2) |
| Transient red at `9f23e0a` | Disclosed in both the commit message and W3 notes: 3.2 (GREEN) lands before 3.3's consumers rewire, so sync/resolve suites transiently break at that commit by design (no shims, per AD-6); slice boundary green | Accepted — verified `sync.ts` at `9f23e0a` still imports the removed `mcp/server` exports; strict TDD's boundary is the slice gate, which was green |
| 5.1/5.2 docs-only TDD exception; hardening config-only exception; gate tasks carry no empty commit | All labeled with rationale | Accepted — correct disciplines |
| Post-gate UX addition (tab completion) | Disclosed with surface list; `@inquirer/core` promoted to direct dependency; PromptPort/scriptedPort seam untouched; 11 helper tests | Accepted — `dcd1a7c` touches exactly the disclosed 5 files; `setup-completion.ts` keeps ambient reads at the console edge only; seam interfaces unchanged |

**No undisclosed RED/GREEN gap found.** Attention area 10 verdict: **spec-compliant**.

## 5. Requirement/Scenario coverage (all files named; all verified passing at HEAD)

### project-config (NEW capability — 7 R / 21 S) — impl `src/config/project-config.ts`, `src/cli/commands/setup.ts`, `src/util/{append-lines,errors}.ts`, `src/config/env.ts`, consumers `src/mcp/server.ts`, `src/cli/commands/{sync,resolve}.ts`, `src/cli/commands/setup-completion.ts`
- **R file format and location (3 S)** — `test/config/project-config.test.ts`: happy path l.249 (flat shape loads as-is); corrupt JSON l.172 + chain-level l.352 ("corrupt file fails safe to unconfigured — the same pinned error, no parse crash"); relative vault l.214 (loader) + l.368 (same pinned error as missing file). Full fail-safe matrix also covers unreadable l.156, non-object roots l.182, vault missing/non-string l.194/205, author half-present dropped l.223, unknown keys ignored l.236. End-to-end: `test/cli/commands/sync.test.ts` l.232 (project-file author lands in real commits). ✔
- **R one resolution chain (4 S)** — unit: `project-config.test.ts` flag>env>file l.292, env>file l.307, file-last l.321, nothing→pinned error l.332 (byte-exact, plus hint). Surface-level: `test/mcp/server.test.ts` l.42/57/72/91/136/161/183 — including the **non-tautological verbatim literal pin** l.161 and the subdir-launch case l.91; `sync.test.ts`/`resolve.test.ts` l.306/l.311 subdir-launch acceptance halves; live CLI smoke confirms the bytes in the compiled artifact. The "no other source" clause is grep-enforced (dead symbols + `SUPERMEMORY_CONFIG_DIR` zero hits; AD-4 hint is the only design-pinned exception). ✔
- **R author resolution and degradation (2 S)** — `sync.test.ts` l.232 (with-author ⇒ both engine commits carry the project author) and l.269 (no-author ⇒ inherits the vault's git identity; asserted against real `%an <%ae>` log output, hermetic via `vaultFlag`+`basePath`); engine-level pin `test/sync/engine.test.ts` l.203 (human author + trailers). ✔
- **R setup guards (3 S)** — `test/cli/commands/setup.test.ts`: home-root refused FIRST even as a git repo l.118; non-work-tree refused l.147; real project passes l.216; refusals write nothing l.172; pinned `SETUP_LOCATION_REFUSED` bytes with interpolated dir; live smoke re-confirms the no-write refusal in a compiled binary. ✔
- **R setup validates the vault before writing (2 S)** — re-prompt on failed attempt l.240; five-failures abort with zero artifacts l.518; decline-stop l.262; `~` against the injected home l.284. ✔
- **R setup writes fresh, never merges (5 S)** — l.330 (subdir invocation writes all three artifacts at the work-tree root); l.361 (fresh rewrite: `{ "vault": "/old/vault", "legacy": true }` pre-seed survives nowhere; serialization byte-pinned); l.392 (author defaults from `readGitIdentity`); l.420 (gitignore appended only when missing; `node_modules/` byte-unchanged); l.437 (idempotent second run — whole-file byte pin `node_modules/\nsupermemory.json\n` + exactly one line); CRLF N7 port l.458. ✔
- **R example template semantics (2 S)** — created-when-absent with exactly `EXAMPLE_CONFIG_CONTENT`, no author substring anywhere l.475; pre-placed committed example byte-identical after setup l.497; constant itself pinned l.48 + l.385. ✔
- Supporting: `test/util/append-lines.test.ts` (8 N7-semantics tests incl. negation, raw non-UTF-8 byte, no-op mtime pin); `test/cli/commands/setup-completion.test.ts` (11 helper tests, disclosed UX surface).

### boot-validation (MODIFIED — 1 R / 2 S) — impl unchanged `src/boot/validate-boot.ts`; source-list re-anchored
- **R fail-fast actionable errors (2 S)** — "Missing rules.md yields located, actionable message" (unchanged scenario): `test/boot/validate-boot.test.ts` l.66 (check 3 points at vault init; all five checks still pinned l.34–102). "Unconfigured environment yields the setup command" (rewritten source list flag/env/project file): `test/mcp/server.test.ts` l.183 (serveVault fails fast, serves nothing) + the two byte-exact pins l.136/161; `fakeEnv` no longer carries `SUPERMEMORY_CONFIG_DIR`. Boot validation consults no global source — grep-verified. ✔

### sync-ladder (MODIFIED — 1 R / 2 S)
- **R human authorship with trailer provenance (2 S)** — "Agent-driven save commits as the human": `test/sync/engine.test.ts` l.203 (author + `Via:`/`Spec:` trailers) + `sync.test.ts` l.232 end-to-end through the project file. "Project config without author degrades to inherited Git identity": `sync.test.ts` l.269 (commits proceed, inherited author, still trailer-carrying per the engine pins). Engine consumes the injected identity only — zero diff in `engine.ts`/`git.ts`, `.memory/local.json` referenced nowhere. ✔

## 6. Assertion quality (strict-TDD audit)

- **No tautologies**: automated scan over all seven new/changed suites found zero `expect(literal).toBe(literal)`-shape assertions. The one historic tautology class (comparing the pinned message to the imported constant) is explicitly defended: `server.test.ts` l.161 asserts the raw spec string independent of the constant, with the finding documented in-source.
- **No ghost loops / no smoke-only gates**: the idempotence test asserts the whole `.gitignore` byte content AND the single-line count; the degradation test asserts real `git log` author output on two commits against an independently computed identity; the refusal tests assert absence of all three artifacts, not just exit codes; the unreadable-file test (chmod 000) restores permissions in `finally` for cleanup.
- No implementation-detail CSS/UI assertions exist (no UI in this change). Informational note: the EACCES loader test is POSIX-permission-dependent (it would pass trivially for a root user or on platforms ignoring chmod) — acceptable for this repo's Node ≥22 macOS/Linux targets; severity INFO, no action required.
- Discriminating-by-construction checks: the Phase-6 acceptance tests document their own failure mode ("if `basePath` stopped flowing, resolution falls to ambient cwd and boot fails `NO_VAULT_CONFIGURED`"), and the RED evidence for them was observed against the pre-W3 tree.

## 7. Scope drift vs proposal

- **R1** flat gitignored file ✔; **R2** project-aware setup with guards/loop/writes ✔; **R3** one chain everywhere with the pinned error and hermetic `basePath` seam ✔; **R4** global config + knob + tests deleted atomically, strings swept ✔; **R5** example semantics ✔.
- **Project RULES (explicitly out of scope): zero implementation surface.** Grep over `src/` for RULES hits only the pre-existing vault-side `rules.md`/note-type machinery (M1 scope, untouched by this change per design §5); no per-project filtering, no provenance-rule config keys in `ProjectConfig` (flat shape, unknown keys ignored).
- Migration tooling: none (AD-4's informational existsSync hint is the only legacy surface; the file is never read/imported/deleted — test-pinned at `setup.test.ts` l.589 incl. a `/LEAK/` payload probe). No multi-vault, no `.memory/local.json`, no `.env`-per-project.
- The post-gate UX addition is the only surface beyond the tasks' file lists — maintainer-requested, disclosed, confined (Note 3).

## 8. Review workload / PR boundary

- Chain shape matches the tasks' `Review Workload Forecast`: 5 slices, `stacked-to-main`, pr1 targeting `add-m1-core/pr3-sync-engine`; no chain-strategy drift; nothing pushed (maintainer-owned delivery); `main` untouched throughout.
- Each slice's diff is confined to its disclosed files (§3 re-measurement); W3's engine/git zero-diff held through pr4.
- **Note 1 (review-time decision, carried from tasks/apply):** pr2 is 635 additions (single TDD work unit: 29-scenario enumerated matrix; no cohesive further split without dropping spec coverage) and pr4 is 1,262 gross churn (cohesive unit; documented split point after task 4.2/guards; −250 net deletion reviews fast). No `size:exception` was claimed anywhere — correct per the chained-pr rule; the accept-or-split decision belongs to the maintainer at review.
- **Note 2:** the `ef42710` hardening and the `93d1d33` acceptance tests ride the pr5 branch (recorded in apply-progress's chain table) — reviewers of pr5 should expect two test-only commits beyond the docs work unit; both are disclosed in the slice record.

## 9. RFC v1.3 coherence (attention: one story, no competing chain)

Verified across the six planned touchpoints + sweep: header l.3 = `Draft v1.3 (…legacy .memory/local.json superseded)`; §3 diagram config box = `supermemory.json (gitignored)` with the boot-time "reads at" arrow (l.81–82); §3 invariant 2 = "writes exactly: the gitignored `supermemory.json` (plus the optional committed `supermemory.example.json` and one `.gitignore` line) inside the agent project" (l.109–111); §4.1 `local.json` layout line gone; §5.1 = "there is no global registry" (l.332/344); §6.3 l.429 = "(from the project config's `author`, falling back to inherited Git identity)" — verbatim with the sync-ladder delta; §7.2 walkthrough rewritten (guards, 5-attempt loop, three artifacts, M2 markers, pinned-error paragraph kept); §7.5/§8 updated (chain = env → `supermemory.json` at the nearest Git work-tree root, l.553–554; jsonc pair matches `EXAMPLE_CONFIG_CONTENT` semantics; `SUPERMEMORY_CONFIG_DIR` row and the never-implemented `.env` sentence gone; §10/§12 verified-only as planned). Sweep: `vaults.default`, `~/.config/supermemory/config.json`, `SUPERMEMORY_CONFIG_DIR` → zero hits in the RFC; remaining "global config" strings are only the sanctioned v1.3 supersession note and an unrelated client-config filename. **One chain story confirmed; the 15-location plan landed as one commit (`87d7f75`, 80+/60−); archived docs untouched.**

## 10. Attention areas — explicit verdicts (all ten)

1. **Budget variances (W2 635, W3 465, W4 1,262)** — **disclosed-deviation-acceptable.** Per-task accounting is honest and matches the re-measured diffs; the RED→GREEN double-count explanation for `setup.test.ts` checks out (+182/−160, +66/−29, +399/−9, +202/−17, +20/−164); split point after 4.2 documented; no `size:exception`. Open disposition → Notes 1.
2. **Retracted double-green + `ef42710` hardening** — **disclosed-deviation-acceptable.** Retraction recorded verbatim; hardening verified tests-only (7 files, +25/−4, zero production code); superseding evidence re-confirmed by this phase's first-try 548/548 run.
3. **AD-1 walk-up discovery** — **spec-compliant.** The spec's own "resolved from the launch location" wording plus setup symmetry justify it; `findProjectRoot` is shared by setup and resolution (cannot disagree); subdir-launch is pinned first-class in five suites (`project-config` l.68, `server.test.ts` l.91, `setup.test.ts` l.330, `sync.test.ts` l.306, `resolve.test.ts` l.311) and re-proven live in the compiled binary.
4. **Post-gate setup tab-completion** — **disclosed-deviation-acceptable.** Surface exactly as disclosed (`setup-completion.ts` 171 lines, 5-line `setup.ts` wiring at the console edge, 11 helper tests, lockfile promotion); PromptPort/scriptedPort seams untouched (interface diff: none); ambient reads stay at the edge.
5. **Transient red at `9f23e0a`** — **disclosed-deviation-acceptable.** Documented in the commit message and W3 notes; caused by the AD-6 no-shim rule; the slice gate (3.4) is the TDD boundary and was green.
6. **`serve.ts` help-text touch in W5** — **disclosed-deviation-acceptable.** Identical stale string + stale chain comment; leaving it would have violated the success-criteria sweep; one line each; no test pinned the old bytes (grep-verified zero hits before edit, per disclosure).
7. **Task 0.1 stale hash (`11199e9` vs real base `24fe9cb`)** — **disclosed-deviation-acceptable.** Historical bytes; the condition (archived work present; pr1 cut from the base tip) verified against reality: `merge-base(base, pr1) = 24fe9cb` = base tip.
8. **AD-4 pinned hint line** — **spec-compliant.** It is the ONLY user-visible "global config" string in `src/` (all other hits are code comments); byte-pinned by `setupCompletionLines` tests; the no-global-language sweep correctly did not touch it.
9. **Benign npm stderr line** — **disclosed-deviation-acceptable.** Durable disclosure exists in apply-progress Phase 6 (deterministic commander `exitOverride` register-test artifact, "not a failure and not a flake"); reproduced identically in this phase's run.
10. **TDD evidence honesty** — **spec-compliant.** All RED commits real and observed-RED; all named disclosures (interruption+resume, retraction, merge-write-at-4.2, register-edge pins in 4.4, per-slice variances, docs-only/config-only exceptions) verified against the repository; zero undisclosed gaps.

## 11. Findings and dispositions

| # | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| 1 | pr2 (635+) and pr4 (1,262 gross) exceed the 400-line review budget; no `size:exception` claimed; decision deliberately deferred to review | NOTE (review-time) | Maintainer decides at delivery: accept the cohesive units, or split pr4 at the documented point (after task 4.2). Carry the prepared W4-over-budget paragraph into the pr4 PR description (apply-progress already drafted it) |
| 2 | Hardening `ef42710` + acceptance tests `93d1d33` ride the pr5 branch rather than their "home" slices | NOTE | Disclosed in the chain table; no rebase recommended (would rewrite the disclosed stack for zero behavioral gain) |
| 3 | HEAD extended `2c5000b` → `ba5cf6b` beyond the parent-cited target (post-gate UX addition) | NOTE (informational) | Disclosed, maintainer-requested, verified in full; no action |
| 4 | EACCES loader test is permission-model-dependent (root/Windows would pass trivially) | INFO | Acceptable for the repo's targets; no action required |

**Exact blockers: none.**

## 12. Archive readiness

Native status already reports archive **ready**; this report does not gate it. On archive, the three deltas apply cleanly to canon (`openspec/specs/{boot-validation,sync-ladder}` modified; `project-config` added — canon dirs confirmed present for the modified pair), and the W4-over-budget note should travel into the pr4 PR description when the maintainer opens the stacked PRs. Nothing pushed by this phase; delivery remains maintainer-owned.
