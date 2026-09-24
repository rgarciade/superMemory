# Archive Report — add-m1-core (M1: Core, dogfood-ready)

Phase: archive · Status: **PASS** · Date: 2026-09-23 · Artifact store: `openspec` (repo-local)

## Preconditions

| Check | Result |
|---|---|
| Verification report present and clearly passing | PASS — `verify-report.md`: PASS-WITH-NOTES, zero blockers, 53/53 tasks complete |
| Tasks complete | PASS — 53/53 (`tasks.md`) |
| Artifacts present | PASS — proposal.md, design.md, explore.md, tasks.md, apply-progress.md, verify-report.md, specs/ (5 deltas) |
| Destructive deltas | NONE — all five delta specs contain only `## ADDED Requirements`; no MODIFIED, no REMOVED. Per `config.yaml` (`Warn before merging destructive deltas`): the only deletions in the change are its own scaffolding rollback (SQLite probe, TROUBLESHOOTING doc, P2 stub surface), already reviewed in verify-report §9 |
| Same-domain active changes | NONE — `add-m1-core` was the only active change under `openspec/changes/` |
| Sync timing | Canonical specs composed at archive time under explicit parent instruction (the five capabilities are new; no prior canonical spec existed, so each delta's ADDED requirements become the full canonical Requirements section) |

## Artifacts read

`openspec/config.yaml`, `proposal.md`, `specs/{boot-validation,index,rules-parsing,sync-ladder,tool-catalog}/spec.md`, `design.md`, `tasks.md`, `apply-progress.md`, `verify-report.md`.

## Domains synced (all new canonical specs)

| Capability | Canonical path | ADDED | MODIFIED | REMOVED | Requirements | Scenarios |
|---|---|---|---|---|---|---|
| boot-validation | `openspec/specs/boot-validation/spec.md` | 2 | 0 | 0 | 2 | 5 |
| index | `openspec/specs/index/spec.md` | 4 | 0 | 0 | 4 | 5 |
| rules-parsing | `openspec/specs/rules-parsing/spec.md` | 4 | 0 | 0 | 4 | 10 |
| sync-ladder | `openspec/specs/sync-ladder/spec.md` | 11 | 0 | 0 | 11 | 20 |
| tool-catalog | `openspec/specs/tool-catalog/spec.md` | 7 | 0 | 0 | 7 | 11 |
| **Total** | | **28** | **0** | **0** | **28** | **51** |

All ADDED requirement bodies and Given/When/Then scenarios are byte-identical to the verified deltas (`diff`-checked per capability); totals match verify-report §1's coverage matrix (28 requirements / 51 scenarios).

## Verification findings carried into the record

The two informational findings requested for the apply-progress archive record are appended to `apply-progress.md` ("Archive record" section): (1) dev-dep `typescript` 5.9.3 → 7.0.2 at commit `b5b22a0`, verified green (suite ×2, typecheck, build), superseding slice-3 deviation #5; (2) the transient real-git flake (2 × 5 s timeouts in `test/cli/commands/resolve.test.ts` under full parallelism) reproduced once at verify and green on rerun. Non-blocking verify findings (obsolete `index/<type>.md` on type removal; rules-refused per-tool-call gating/hot catalog rebuild unwired; timeout hardening; live-server conflict-flip immediacy) remain recorded in verify-report §6–§7 and travel with the archive as follow-up input for future changes.

## Archive move

- `openspec/changes/add-m1-core/` → `openspec/changes/archive/add-m1-core/` (parent instruction fixes the archive path without a date prefix; the archive dir pre-existed with `.gitkeep`).
- All artifacts (including this report, appended before the move) travel with the change; nothing deleted, no historical bytes modified except the additive archive record in `apply-progress.md`.
- Commit: one work-unit commit on `add-m1-core/pr3-sync-engine`. No push (user-owned).

## Memory observation IDs

Not applicable — artifact store is `openspec` (no Engram persistence layer required for this mode).
