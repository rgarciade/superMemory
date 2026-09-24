# Archive Report — add-project-config (per-project `supermemory.json` replaces the global config)

Phase: archive · Status: **PASS** · Date: 2026-09-24 · Artifact store: `openspec` (repo-local)

## Preconditions

| Check | Result |
|---|---|
| Verification report present and clearly passing | PASS — `verify-report.md`: PASS-WITH-NOTES, **zero blockers**, 56 files / 548 tests green first try, typecheck + build clean, CLI smoke green incl. the byte-pinned unconfigured error and the setup refusals |
| Tasks complete | PASS — 21/21 (`tasks.md`) |
| Artifacts present | PASS — proposal.md, design.md, tasks.md, apply-progress.md, verify-report.md, specs/ (3 deltas) |
| Sync timing | Archive-time sync ran under explicit parent instruction (no separate `sdd-sync` phase; no `sync-report.md` — the parent prompt directly ordered the delta application at archive time) |
| Destructive deltas | NONE destructive — zero REMOVED requirements; two MODIFIED blocks replace small regions in place (~14 lines boot-validation, ~11 lines sync-ladder) with the parent's explicit per-file instructions; no scenario dropped (boot-validation keeps both scenarios, one re-anchored; sync-ladder goes 1 → 2 scenarios) |
| Same-domain active changes | NONE — `add-project-config` was the only active change under `openspec/changes/` (besides `archive/`) |

## Artifacts read

`openspec/config.yaml`, `proposal.md`, `design.md`, `tasks.md`, `apply-progress.md`, `verify-report.md`, `specs/{project-config,boot-validation,sync-ladder}/spec.md`, canonical `openspec/specs/{boot-validation,sync-ladder}/spec.md`, archived `add-m1-core/` convention (incl. its `archive-report.md`).

## Domains synced

| Capability | Operation | Canonical path | ADDED | MODIFIED | REMOVED | Requirements | Scenarios |
|---|---|---|---|---|---|---|---|
| project-config | NEW (wholesale) | `openspec/specs/project-config/spec.md` | 7 | 0 | 0 | 7 | 21 |
| boot-validation | MODIFIED in place | `openspec/specs/boot-validation/spec.md` | 0 | 1 | 0 | 2 | 5 |
| sync-ladder | MODIFIED in place | `openspec/specs/sync-ladder/spec.md` | 0 | 1 | 0 | 11 | 21 |

**Requirement names:**

- **ADDED (project-config, new canonical spec composed wholesale from the delta — `## ADDED Requirements` semantics; the delta was already authored in canonical form with `## Requirements`):** Project config file format and location · One resolution chain shared by every surface · Author resolution and degradation · Setup guards refuse meaningless locations · Setup wizard validates the vault before writing · Setup writes fresh, never merges · Example template file semantics (21 scenarios, byte-identical copy, `diff`-verified).
- **MODIFIED (boot-validation):** *Fail-fast actionable errors* — the requirement prose gains the source-precedence ownership clause (flag → `SUPERMEMORY_VAULT` → project config file, owned by `project-config`); scenario *Unconfigured environment yields the setup command* re-anchored from "global config" to the project file with "exactly" added to the THEN. Scenario *Missing rules.md yields a located, actionable message* unchanged.
- **MODIFIED (sync-ladder):** *Human authorship with trailer provenance* — author source re-anchored from the never-implemented `.memory/local.json` to the project config file's `author` with the inherited-Git-identity fallback, ownership clause added; scenario *Agent-driven save commits as the human* concretized; scenario *Project config without author degrades to inherited Git identity* **added**.
- **REMOVED:** none.

**Verification of the merge:** every untouched canonical requirement and scenario byte-identical to HEAD (`diff`-checked: boot-validation content before the block + sync-ladder content before and after the block), and each replaced block matches its delta modulo the delta-only `(Previously: …)` change-note parentheticals — those are change-tracking metadata and intentionally stay in the archived deltas; canonical specs carry current behavior (add-m1-core convention: canonical = current truth, provenance lives in the archive).

## Verification findings carried into the record

Appended to `apply-progress.md` ("Archive record" section): (1) review-budget carry-into-delivery — pr2 (635 gross) and pr4 (1,262 gross churn) exceed the 400-line budget as cohesive units with no `size:exception`; pr4's documented split point is after task 4.2 (guards) and the pre-drafted W4-over-budget paragraph travels into the pr4 PR description; (2) the pr5 PR description should mention the two disclosed test-only commits (`93d1d33` acceptance pins, `ef42710` gate hardening) beyond the docs work unit. All other verify notes (§6 informational EACCES permission-model note; §7 zero RULES surface) remain recorded in the verify report and travel with the archive.

## Archive move

- `openspec/changes/add-project-config/` → `openspec/changes/archive/add-project-config/` (same convention as `add-m1-core`: parent instruction fixes the archive path without a date prefix).
- All artifacts (including this report, written before the move) travel with the change; nothing deleted, no historical bytes modified except the additive archive record in `apply-progress.md`.
- Commit: one `docs(openspec)` work-unit commit on `add-project-config/pr5-rfc-docs` (final PR of the 5-slice chain). No push (maintainer-owned delivery).

## Memory observation IDs

Not applicable — artifact store is `openspec` (no Engram persistence layer required for this mode).
