# Proposal — add-project-config (per-project local config replaces the global config)

Phase: proposal · Status: complete
Inputs: parent explore findings (verified in source), `docs/RFC.md` v1.2, `openspec/specs/boot-validation/spec.md`, `openspec/specs/sync-ladder/spec.md`, `openspec/config.yaml`, archived change `add-m1-core`

---

## Why (Problem & Motivation)

**The global config cross-contaminates agent projects.** Today `~/.config/supermemory/config.json` holds exactly one `vaults.default` for the whole machine (RFC §8, `src/config/global-config.ts`). But supermemory is used *from agent projects* — each repo an agent works in — and a machine-wide default means every project silently resolves to the same vault: notes researched for project A surface in project B's retrieval, commit provenance blurs, and the only escape is remembering `--vault`/`SUPERMEMORY_VAULT` per invocation, which defeats having a default at all. The vault a project uses is a **per-project decision**; the current design stores it in the one place that cannot express that.

**The RFC already conceded the principle.** RFC §4.3 planned `.memory/local.json` — a gitignored, per-user identity file *because* "per-user, machine-local settings must not live in shared state." That mechanism was deferred (never implemented in M1), but the reasoning applies with more force to vault selection: the choice of vault is not just per-user, it is per-project. This change adopts the same philosophy at the right level: a gitignored `supermemory.json` **in the agent project**, not in the vault, not in `~/.config`.

**The global config is also dead weight that this makes removable.** It exists to answer one question ("which vault, and who is the author") for a single-vault M1 world. Moving both answers into the project file lets the whole module, its `SUPERMEMORY_CONFIG_DIR` knob, its merge-write in `setup`, and four consumer imports be deleted — fewer config surfaces, one obvious place to look, and the `vaults.default` map shape dies with the mechanism it existed for.

## Proposed Change

Replace the per-user global config with a per-project local config file, make `setup` project-aware, and re-anchor the resolution chain every surface shares. Shaped as user-value requirements (spec phase formalizes wording):

### R1 — Per-project config file: "the agent works in this repo, so it uses this repo's vault — no flags, no ceremony"

`supermemory.json` at the agent-project root, **flat** shape:

```jsonc
{ "vault": "/absolute/path/to/vault", "author": { "name": "...", "email": "..." } }
```

- Flat by design: the `vaults.default` map existed only for the global registry; with the global config gone, the map shape goes with it (session decision).
- `vault` is an absolute path (the file must resolve correctly regardless of later launch cwd).
- Local-only: setup appends `supermemory.json` to the project `.gitignore` (append-if-missing) — per-user paths and identity never get committed.

### R2 — Project-aware setup: "a team member wires a new agent project in one 30-second wizard run"

`supermemory setup` run inside an agent project:

- **Guards first**: must be inside a git work tree; refuse sensible bad locations — `$HOME` root, paths outside any work tree — with actionable errors (the `NO_VAULT_CONFIGURED` remediation story depends on setup itself never being runnable somewhere meaningless).
- **Vault prompt**: same `validateBoot` loop as today, ≤5 attempts (`MAX_VAULT_ATTEMPTS = 5`), re-prompt with "Try another path?" on failure.
- **Author prompt**: defaults read from the vault's git identity (`readGitIdentity(vault)`), exactly as today.
- **Writes `./supermemory.json`** (flat shape above) — a fresh write, no merge, at the project root.
- **Appends `supermemory.json` to the project `.gitignore`** if the line is missing; never touches other lines (requires extracting/lightening the vault-bound `mergeMissingLines` seam from `src/cli/commands/init.ts:613` for reuse).
- **Creates `supermemory.example.json` if absent** (R5); never overwrites it.

### R3 — One resolution chain everywhere: "serve, sync, and resolve can never disagree about which vault is in play"

Chain, shared by `serve`/`sync`/`resolve` (today: one resolver, `resolveVaultPath` at `src/mcp/server.ts:260`; consumers `serveVault` :287, `runSyncCommand` `sync.ts:139`, `runResolveCommand` `resolve.ts:116`):

```text
--vault flag → SUPERMEMORY_VAULT env → ./supermemory.json (cwd-based,
explicit injectable base path for tests) → AppError NO_VAULT_CONFIGURED
with the EXISTING pinned message "No vault configured. Run: supermemory setup"
```

- The pinned message is byte-pinned by `test/mcp/server.test.ts:80` and spec-mandated — it must not change; only the step that feeds it changes (global config → project file). Setup remains the remediation the message promises.
- Author: project file `author` when present; **falls back to inherited git identity when absent** — the same documented degradation as today's un-setup case (commits author as the vault repo's git config).
- The project-file loader takes an explicit base-path/cwd parameter — the exploration confirmed there is **no injectable cwd seam today** (`withTestEnv`/`fakeEnv` sandbox only env + configDir), and hermetic tests must not depend on process cwd.

### R4 — Global config removed: "one obvious place to look, nothing half-alive"

- Delete `src/config/global-config.ts` (`GlobalConfig`, `loadGlobalConfig`, `saveGlobalConfig`, `configDirFor`, `resolveDefaultVault`) and all four consumer imports (`server.ts`, `sync.ts`, `resolve.ts`, `setup.ts`).
- Remove the `SUPERMEMORY_CONFIG_DIR` env knob (code, RFC §8 table row, tests that sandbox via `withTestEnv({ configDir })`).
- Update user-visible strings that say "global config": setup's confirm message ("Write vaults.default=… to the global config?") and completion log.
- **RFC**: supersede the deferred `.memory/local.json` (§4.3, referenced again §6.3/:423) — the project file is now the gitignored local-identity mechanism; update the documented resolution chain (§8/:537); re-anchor §2 invariant 2 ("outside the vault it writes exactly two things"), §5.1's "same global registry" (M2 multi-vault will build on per-project config, not a global registry), and §7.2's setup walkthrough. Archived design docs (`:341`/`:378`) are historical records and stay untouched.
- Canonical spec deltas: see *Capabilities Affected*.

### R5 — `supermemory.example.json`: "a new teammate's agent works on first clone"

- Committed **by the maintainer/user** into agent projects as the onboarding template: contains the vault reference (e.g. vault name/path placeholder), **never author identity** — identity is per-user, and the file is shared.
- `setup` may create it if missing (so a solo user gets a template for free) but **never overwrites** a committed one.
- The committed example + gitignored local file is the pair teams copy for every new project.

## Capabilities Affected (spec deltas for the specs phase)

1. **project-config — ADDED (new capability).** Owns: file format/location/gitignore status, the canonical resolution chain (flag → env → project file → pinned error), author resolution + documented degradation, project-aware `setup` (work-tree guard, prompts, write/gitignore/example behavior), and example-file semantics. **Rationale:** three existing specs would otherwise each grow overlapping chain requirements; one canonical home keeps one chain and one file contract, testable once. `boot-validation` stays about *validating a given path* — not *producing* it.
2. **boot-validation — MODIFIED.** The "Unconfigured environment yields the setup command" scenario's GIVEN names the resolution sources ("launch flag, `SUPERMEMORY_VAULT`, or global config") — update the source list to the project file and point at `project-config` as the chain's canonical home. The five vault checks and the pinned message are unchanged.
3. **sync-ladder — MODIFIED.** "Human authorship with trailer provenance" (:75) says the author comes "from `.memory/local.json` or inherited Git config" — a mechanism M1 never implemented. Update the source clause to "the project config's `author`, falling back to inherited Git identity." No sync-behavior change.

## Migration Story (recommendation: no migration)

**Recommended: no one-time migration; current users' global config is simply ignored.**

- The tool is **unreleased** (no `npm publish`; M1 exists only on local branches for dogfooding). The affected population is the maintainer's own machines.
- The ignore path **fails safe into the remediation**: unresolvable vault ⇒ `NO_VAULT_CONFIGURED` ⇒ the pinned message says "Run: supermemory setup" ⇒ the new project-aware setup is a 30-second wizard. No dead ends.
- Auto-migration would **reintroduce the bug this change fixes**: seeding every agent project from the same global `vaults.default` is exactly the cross-project contamination being removed, and "which vault for *this* project" is a per-project decision only the human can make at setup time.
- A migration read-path would keep `global-config.ts` half-alive — the deletion is the point.
- We stop **reading** the global config; we never **delete** the user's `~/.config/supermemory` data (spirit of "never silently delete"). Docs note it can be removed manually.
- Optional nicety for design: `setup` may `existsSync`-check the legacy path and print one informational line. Not essential.

## Decisions & Rationale

- **D1 — Flat shape, not `vaults.default`.** The map existed for the global registry; a per-project file answers exactly one vault. Flat is simpler to validate, document, and hand-edit. (Session decision, ratified here.)
- **D2 — File at the agent-project root; vault stays a separate repo.** The project file *points at* the vault; supermemory keeps writing nothing inside agent projects except `supermemory.json` (+ optional example) and one `.gitignore` line.
- **D3 — Author fallback stays "inherited git identity", unchanged semantics.** When the project file lacks `author`, commits inherit the vault repo's git config — identical to today's setup-not-run degradation. RFC §4.3's local-identity intent is preserved by the project file; only the location changes.
- **D4 — New `project-config` capability rather than stretching `boot-validation`.** See *Capabilities Affected*: produce-vs-validate split, one canonical chain.
- **D5 — No migration.** See *Migration Story*.

## Out of Scope (explicitly deferred)

- **Project RULES** — per-project filtering, provenance rules, extra validations. Possible future change; this change ships only vault + author.
- Multi-vault mode, `project` tool argument, vault registry/confirm flows (M2 territory; M2 design will re-anchor on project config).
- Implementing `.memory/local.json` anywhere — superseded, not relocated.
- Any migration/import tooling for the global config (D5).
- `.env`-per-project or sync-mode overrides (RFC §8 unchanged in that respect).

## RFC §12 milestone mapping

Not an M1/M2/M3 line item: a **corrective change to M1's single-vault configuration story**, motivated by dogfooding M1. It must land **before M2 multi-vault work** (M2's design builds on where vault selection lives; this change moves that foundation from a global registry to per-project config — RFC §5.1 references get re-anchored here so M2 designs against reality).

## Rollback Plan

This change deletes a module and rewires boot resolution — treat as risky; rollback is staged and lossless:

- **User data is never touched**: the code stops reading `~/.config/supermemory`; it never deletes it. Rolling back the code fully restores the old behavior against the still-present file.
- **All implementation on a branch**; each phase/PR reversible by revert-PR. Restoring `global-config.ts` and the four imports is a pure `git revert` — no schema, no persisted state to migrate back (the project files are new, additive files).
- **Artifacts `setup` wrote into agent projects** (`supermemory.json`, `.gitignore` line, optional `supermemory.example.json`) are user-local; rollback does not remove them — a docs note lists manual cleanup (delete file, drop one gitignore line). The `.gitignore` append is append-if-missing and never rewrites other lines, so worst case is one stale ignored-file entry.
- **Spec deltas**: per `openspec/config.yaml` archive rules, destructive deltas warn before merge; the boot-validation/sync-ladder modifications revert with the same revert-PR.
- **Test rollback**: tests move from `configDir` sandboxing to project-dir fixtures; reverting the code reverts the tests in the same PR.

## Risks

1. **cwd-discovery miss window (headline risk).** Project-file resolution depends on launch cwd. Pi-spawned MCP servers inherit the project dir (pi-mcp-adapter `init.ts:118` → server-manager `defaultCwd`), but clients that launch elsewhere (e.g. app-dir cwds) will not find `./supermemory.json` and fail with `NO_VAULT_CONFIGURED`. Mitigation: fail-fast + actionable message (unchanged), `--vault`/`SUPERMEMORY_VAULT` remain full escape hatches, docs cover client-config cwd; the error hint names them.
2. **Discovery semantics asymmetry.** Setup writes at the project root (even from a subdir); resolution reads `./supermemory.json` at cwd (session decision). Running `sync` from a project subdir misses the file. Mitigation: flag in Open Decisions — design may adopt walk-up-to-work-tree-root lookup; cwd-exact is the conservative default.
3. **Test-infra churn.** Every test sandboxes config via `SUPERMEMORY_CONFIG_DIR`/`withTestEnv({configDir})`; all must move to tmp project-dir fixtures with an injectable base path. Sizeable but mechanical; the loader's explicit base-path parameter (R3) is the seam that keeps tests hermetic.
4. **Byte-pinned message regression.** The chain changes under a spec-pinned, byte-tested error string. The message is untouched; the pinning test must be updated *for its fixture* (no global config to load) while asserting the identical bytes.
5. **Setup guard over-refusal.** The work-tree guard must refuse `$HOME`-style bad locations without breaking legit monorepo/subdir use (Open Decision: where the file lands when invoked from a subdir). Actionable-error requirement keeps refusals non-dead-end.
6. **RFC coherence.** Six RFC touchpoints (§2, §4.3, §5.1, §6.3, §7.2, §8) + two spec deltas; a partial edit leaves two competing chains documented. Mitigation: one tasks-phase work unit owns all doc/spec deltas atomically.

## Success Criteria

- Running `serve`/`sync`/`resolve` inside a project with `supermemory.json` resolves the vault from the project file, with no flags/env set; with the file absent, all three fail with exactly `No vault configured. Run: supermemory setup`.
- Precedence holds: `--vault` beats `SUPERMEMORY_VAULT` beats `./supermemory.json`; verified per-surface.
- `setup` refuses `$HOME` root / non-work-tree locations with actionable errors; inside a project it validates the vault (≤5-attempt loop), defaults author from the vault's git identity, writes the flat file, appends `.gitignore` if missing (never otherwise modifying it), and creates `supermemory.example.json` only when absent.
- The example file, as setup creates it, contains a vault reference and no author keys.
- Commits carry the project-file author; with author absent, they inherit git identity (documented degradation, tested both ways).
- `src/config/global-config.ts` and every import are gone; `SUPERMEMORY_CONFIG_DIR` appears nowhere in code, tests, or docs; no user-visible string says "global config".
- Project-file loading is hermetic: tests inject a base path; no test depends on process cwd or real `HOME`.
- `vitest run` green; RFC §2/§4.3/§5.1/§6.3/§7.2/§8 and the two spec deltas updated in the same change; `.memory/local.json` formally superseded.

## Open Decisions Carried into Design

- **Discovery semantics for resolution**: exact `./supermemory.json` at cwd vs upward walk to the git work-tree root (matches setup's root placement; costs a fs walk per boot). Session default: cwd-exact.
- **Work-tree guard details**: top-of-work-tree vs any-subdir invocation for setup's write location; the exact bad-location denylist (`$HOME`, `$HOME` root equivalents, `/tmp`?) and their messages.
- **Example-file contents**: exact vault-reference form (path placeholder vs name) and whether setup's created example embeds the just-answered vault path.
- **Legacy-config informational hint** in setup (Migration Story nicety) — include or drop.
- **Extracted gitignore seam**: generalize `init.ts` `mergeMissingLines` into a shared util vs a lighter setup-local append — and whether `init` migrates to the shared util in this change or later.
- **Loader failure modes**: corrupt/invalid `supermemory.json` — behave as "not configured" (fail-fast to setup, mirroring today's corrupt-global-config behavior) vs a distinct actionable error naming the file. Lean: distinct error naming the file (better remediation), decide in design.

## Delivery Note (explicitly not decided here)

Forecast: resolver + loader (~150) + setup rework (~200) + gitignore/example (~80) + consumer/test churn (setup.test.ts ~300, server/sync/resolve tests ~150, new loader tests ~200) + RFC/spec deltas (~200) ≈ **1,200+ changed lines** → **400-line budget risk: High; chained PRs likely** (project-config loader + resolver / setup + guards / doc+spec deltas are natural seams). Per session preflight (`ask-on-risk`), the flow pauses at the delivery gate rather than inventing a chain strategy or accepting an exception. No code changes, commits, or pushes were made in this phase.
