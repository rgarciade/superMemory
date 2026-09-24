# Exploration Report — add-m1-core

Phase: explore · Status: complete · Read-only (no files modified, no commits)

## Executive Summary

Repo is truly greenfield: `docs/RFC.md` (v1.2, authoritative), `openspec/config.yaml`, `.gitignore`, `.atl/skill-registry.md`, `.pi/gentle-ai/sdd-preflight.json`, zero-commit `main` tracking `origin` (`git@github.com:rgarciade/superMemory.git`). No source code, no `package.json`, no tests.

**Recommendation: M1 as ONE SDD change with three internal phases; chain decision deferred to apply (ask-on-risk).** M1 is the RFC's own unit of delivery ("dogfood-ready"): `save` needs templates + index + Linked Knowledge maintenance; `sync` needs commit grammar over frontmatter; the end-to-end loop is only testable as a whole. Splitting into multiple SDD changes would ship no independently valuable slice and force three spec deltas that revise each other. The 400-line budget is a review constraint, not a design one — pre-plan the phase seams so apply-time chaining is mechanical.

## Answers to the Four Framing Questions

1. **One change, not several.** Chain seams within apply (if budget triggers chaining):
   - PR-1: scaffold + rules parser + templates + CLI `init`/`setup` + boot validation
   - PR-2: SQLite index + MCP catalog (all 6 tools)
   - PR-3: sync engine + commit grammar + conflict ladder + secrets lint + `sync` CLI
   Seams follow RFC module boundaries (§4/§5/§6).

2. **Scaffold decisions for design:**
   - Layout: single npm package (ships via `npx supermemory`): `src/cli`, `src/rules`, `src/index`, `src/sync`, `src/mcp` + design should ADD `src/config` (global config/env resolution, RFC §8) and a boot-validation module (RFC §3) — needed by both `setup` and `serve`.
   - Module system: ESM (`"type": "module"`, NodeNext); better-sqlite3 is CJS-native, default-import interops — verify in phase-1 smoke test.
   - `@modelcontextprotocol/sdk`: pin exact/minor (MCP spec churn risk, RFC §11); check the SDK's zod peer range BEFORE choosing zod 3 vs 4.
   - `better-sqlite3`: pin version; prebuilds cover common platforms; document `npm rebuild` fallback; FTS5 is bundled by default but boot validation should capability-probe and fail fast with an actionable message.
   - vitest: wire as an explicit phase-1 task + flip `strict_tdd: true` + backfill `apply.test_command` / `verify.test_command` / `build_command` in `openspec/config.yaml`.
   - `package.json`: `name: supermemory`, `bin` entry, `engines` pinned to Node LTS.
   - **Stack gap discovered:** RFC §8 lists no YAML parser, but `.memory/config.yml` and fenced YAML blocks in `rules.md` both need one → add `yaml` (or justify js-yaml reuse). `{{placeholder}}` templates need only string interpolation — no handlebars.
   - CLI lib: RFC names none — design decision (commander or similar).

3. **Testing without a real vault:** committed minimal fixture vaults (`test/fixtures/`) as templates, materialized into `os.tmpdir()` by a `createTestVault()` factory — never commit nested `.git` dirs. Sync tests use a local bare repo (`git init --bare` in tmp) as the "remote" — fully hermetic pull-rebase/push/conflict paths. Boot validation: one negative fixture per check (missing dir, non-git, missing rules.md, unsupported format_version, inside-app-repo guard). Conflict ladder: divergent local/remote commits asserting the invariant (rebase aborted, snapshot branch, conflict note written, nothing lost — "never silently delete" is the headline test). Sync scheduler: injectable clock (fake timers). Rules parser: pure functions. MCP layer: thin contract test via SDK in-memory client transport. Env overrides (`SUPERMEMORY_CONFIG_DIR`, `SUPERMEMORY_VAULT`) are the hermetic config hooks.

4. **Baseline git state:** recommend phase-0 baseline commit on `main` — `chore: baseline docs + openspec` with `docs/RFC.md`, `openspec/config.yaml`, `.gitignore` (with the `.atl/` decision recorded) — BEFORE branching. Rationale: first PR's 400-line budget must measure real code; branch diffs need a root commit; `origin` exists. Pushing remains a user decision.

## Flags for Proposal

- `.gitignore` ignores `.atl/` entirely. `.atl/skill-registry.md` is auto-generated with machine-specific paths — keeping it ignored is defensible; record as explicit decision. `.pi/gentle-ai/sdd-preflight.json` is untracked session-local — recommend adding `.pi/` to `.gitignore` (surface, don't silently decide).
- RFC's own protocol applies once a vault exists (dogfooding via `save`); until then openspec artifacts are the record.

## Risks

1. Review budget: M1 realistically 2000+ lines with tests — far over 400; mitigation: pre-planned chain seams; ask-on-risk pause at apply.
2. better-sqlite3 native install: pin, prebuilds, documented rebuild, FTS5 probe; smoke-test on Node LTS in phase 1.
3. MCP SDK + zod peer incompatibility: verify peerDeps before locking zod; pin SDK minor.
4. Zero-commit baseline: first PR would mix scaffold/docs with feature code — mitigated by phase-0 baseline commit.
5. Greenfield convention vacuum: design doc must fix layout before apply.
6. Sync concurrency hard to test: pidfile lock + debounce need injectable clock/lock seams defined in design.
7. Hidden dependency gaps (yaml parser, CLI lib, module system) — decide in design, not mid-apply.
8. `.atl/` ignore ambiguity: onboarding docs must state it's machine-local (README note, non-blocking).

## Next Recommended

Proceed to proposal for single `add-m1-core` change: three phases in the tasks doc with explicit chain seams + rollback plan (config.yaml proposal rule); proposal must decide (a) phase-0 baseline commit, (b) `.atl/` stays ignored + `.pi/` handling, (c) vitest wiring as phase-1 task with `strict_tdd` flip and config backfill; carry the scaffold decision list into design as open decisions to resolve.
