# Design — add-project-config (per-project local config replaces the global config)

Phase: design · Status: complete
Inputs: `proposal.md` (R1–R5, authoritative scope), the three delta specs in `specs/` (**frozen** — authoritative for behavior; this document decides HOW), `docs/RFC.md` v1.2, verified explore facts (resolver/consumer locations, setup internals, init's `mergeMissingLines`, test-inventory).

Design rules honored (`openspec/config.yaml`): sequence diagrams for the complex flows (§3), architecture decisions with rationale (§1, AD-1…AD-7).

---

## 0. Context and the spec contract

Today one machine-wide file (`~/.config/supermemory/config.json`, `src/config/global-config.ts`) answers "which vault" and "who is the author" for every invocation. This change moves both answers into a gitignored `supermemory.json` at the **agent project's** root, written by a project-aware `supermemory setup`, read through one resolution chain shared by `serve`/`sync`/`resolve`, and deletes the global-config module outright.

The delta specs freeze the behavior. In particular, design does **not** re-litigate:

- the pinned unconfigured error bytes: `No vault configured. Run: supermemory setup` (code `NO_VAULT_CONFIGURED`);
- fail-safe loader semantics: corrupt/non-absolute/missing-`vault` files behave exactly like absent files (see AD-6 — this explicitly overrides the proposal's "distinct corrupt-file error" lean, because the spec scenario `Corrupt file fails safe to unconfigured` already decided it);
- the chain order flag → `SUPERMEMORY_VAULT` → project file → pinned error;
- author degradation to inherited Git identity;
- the setup guard set (work tree + home root), ≤5-attempt vault loop, fresh-write (no merge) semantics, gitignore append-only semantics, example-file never-overwrite semantics.

Where a decision below touches behavior, it stays inside those bounds; everything else is structure, naming, and message wording.

---

## 1. Architecture decisions (AD-1 … AD-7, one per Open Decision)

### AD-1 — Discovery: walk up to the **nearest enclosing Git work-tree root**, not cwd-exact

**Decided.** `loadProjectConfig(basePath)` discovers the file by walking `basePath` and its ancestors (fs `stat` only — no subprocess) for the **first** directory containing a `.git` entry (directory **or** file, so linked worktrees and submodules resolve to their own root), and reads `supermemory.json` at that root only. No ancestor beyond the nearest work-tree root is consulted. Outside any work tree ⇒ no project file ⇒ unconfigured (flag/env still win earlier in the chain).

**Rationale.**

1. **It removes the asymmetry the proposal itself flagged as risk 2.** AD-2 decides setup writes at the work-tree root even when invoked from a subdirectory. Cwd-exact resolution would then create a footgun we build ourselves: `supermemory sync` from `packages/foo/` misses the file setup deliberately placed at the root. Discovery and setup must agree on "where the project root is" — this decision makes both use the **same function** (`findProjectRoot`, AD-2/§2), so they cannot disagree.
2. **It matches the spec's own wording.** `project-config` says the file is "`supermemory.json` at the project root, **resolved from the launch location**". Cwd-exact only satisfies that when the launch location *is* the root; walk-up satisfies it for every launch location inside the project, including monorepo subdirectory MCP launches (pi can spawn the server from a workspace subdirectory).
3. **The false-positive surface is bounded and small.** Only the nearest work-tree root is read — an unrelated `supermemory.json` in some *higher* repo can never shadow a nested project (nearest root wins, mirroring git's own `--show-toplevel` semantics). The remaining false positive requires a file named exactly `supermemory.json` with a plausible absolute `vault` sitting at a git root that is not actually a configured supermemory project — a hand-crafted case whose failure mode is still the actionable pinned error or an obviously-wrong vault a human notices once.
4. **The cost is one bounded walk per process boot** (typical depth ≤ 6 `stat` calls), never on a hot path.

**Why not walk *all* ancestors:** unbounded false positives (an outer repo's file found while working in an inner repo) for zero additional legitimate coverage — setup only ever writes at one root.

### AD-2 — Setup invocation semantics: any subdirectory OK, writes at the work-tree root; denylist is exactly two checks, home-root first; new error code `SETUP_LOCATION_REFUSED`

**Decided.**

- `runSetup` calls `findProjectRoot(basePath)` (the same function resolution uses, AD-1). `undefined` ⇒ refuse. The resulting root is where **all three** artifacts land: `supermemory.json`, the `.gitignore` append, `supermemory.example.json`.
- **Guard order: home-root check first, then work-tree check.**
  1. `basePath === homeDir` ⇒ refuse — *even if the home directory is a git repository* (home-as-dotfiles-repo is common; `findProjectRoot` would succeed there and we would write the file into exactly the meaningless location the spec names). This order is the only one that satisfies the spec's "regardless of whether that directory happens to be a repository".
  2. `findProjectRoot(basePath) === undefined` ⇒ refuse (covers `/tmp/scratch` and every non-project location).
- **No additional denylist entries.** `/tmp` needs no special rule: outside any work tree it is already refused by check 2, and a real git repo created under `/tmp` is a legitimate scratch project we should not over-refuse (proposal risk 5). The spec's denylist is exactly {home root, outside-any-work-tree}; design adds nothing to it.
- **Refusals throw a new stable error code `SETUP_LOCATION_REFUSED`** (added to `ERROR_CODES`), message names the offending directory, hint gives the concrete next action — per the actionable-error convention (design §1.5 of `add-m1-core`): *name what failed + a concrete next action*. Exact bytes, pinned here for the tasks phase to test:

  ```text
  code: SETUP_LOCATION_REFUSED
  message: supermemory setup refuses to run in your home directory (/Users/me): the home root is not an agent project.
  hint: cd into the agent project's Git work tree (any subdirectory is fine) and re-run "supermemory setup". For vaults used outside any project, pass --vault or set SUPERMEMORY_VAULT.
  ```

  ```text
  code: SETUP_LOCATION_REFUSED
  message: supermemory setup must run inside a Git work tree (/tmp/scratch is not one): it writes the project's supermemory.json at the work-tree root.
  hint: cd into the project where your agent works and re-run "supermemory setup". Inside a subdirectory is fine — setup writes at the work-tree root.
  ```

  (The directory in each message is the actual launch directory; the examples show the spec scenarios.)

- **A refusal writes nothing** — guards run before any prompt and before any I/O but reading the launch directory (spec: no `supermemory.json`, no `.gitignore` change, no example file). The ≤5-attempt vault loop and the confirm-decline path already guarantee "nothing written" downstream, because every write happens only after confirmation.
- **`runSetup` signature change** (also the hermetic-test seam):

  ```ts
  runSetup(prompts: PromptPort, io: { basePath: string; homeDir: string }): Promise<SetupResult>
  ```

  The `env: EnvSource` parameter is **dropped** — setup no longer reads or writes any env-based config (the global config and its `SUPERMEMORY_CONFIG_DIR` knob are gone; the legacy hint derives its path from `homeDir`, AD-4). The commander action is the edge that injects `{ basePath: process.cwd(), homeDir: os.homedir() }`.

**Rationale.** Subdirectory invocation writing at the root is the only choice consistent with AD-1 (resolution reads at that same root) — anything else recreates the asymmetry. `homeDir` is injected rather than ambient (`os.homedir()` inside `runSetup`) so guard tests are hermetic. `findProjectRoot` (pure fs) is used for the guard instead of a `simpleGit` `revparse` subprocess so setup and resolution share one definition of "work-tree root" — and linked-worktree setups write at the linked worktree's own root, which is also where resolution will read.

### AD-3 — Example file content: placeholder text, pinned bytes, never the answered vault path, never author keys

**Decided.** When `setup` creates `supermemory.example.json` (only when absent — `writeIfAbsent` with the `wx` flag, same pattern as `init.ts`), it writes exactly:

```json
{
  "vault": "/absolute/path/to/your/vault"
}
```

(with a trailing newline; 2-space indent, matching the project file's serialization).

**Rationale.**

- The example is **committed by definition** (spec: the onboarding template teams copy), so it can never carry a real machine path — the proposal's "literal answered path" option is eliminated by the commit contract, not just by taste. A placeholder is comittable everywhere and self-documenting: it shows the shape (flat, one key) and the rule (absolute path) without lying about any machine.
- **Setup never embeds the just-answered vault path** even though it could: a personal absolute path in a file whose purpose is to be committed is precisely the leak R1's gitignore rule exists to prevent. The gitignored `supermemory.json` sits right next to it holding the truth.
- The placeholder satisfies the spec scenario literally: the created file "contains a vault reference and contains no `author` key or author fields anywhere".
- **Never overwrite** is structural: creation uses the exclusive `wx` flag (race-safe, same `isEexist`-tolerant pattern as `init.ts`'s `writeIfAbsent`), so a committed or hand-edited example is byte-identical after setup — setup never reads it for merging, never "refreshes" it.

### AD-4 — Legacy global config: one-time informational hint in setup, never an import

**Decided.** Include the hint, informationally. After the guards pass, `runSetup` does one `existsSync(path.join(io.homeDir, ".config", "supermemory", "config.json"))`. If present, the path is returned in `SetupResult.legacyConfigPath`; the command binding logs exactly one line:

```text
legacy global config found at {path} — supermemory no longer reads it. You may delete it manually.
```

**Rationale.** The tool is unreleased (affected population: the maintainer's own machines), so migration machinery is unjustified — and proposal D5 already argued auto-migration would reintroduce the cross-project contamination this change removes. The hint is ~3 lines of code, zero behavioral risk, and converts the fail-safe dead-end ("why did my default vault stop working?") into a one-line explanation plus the correct remediation (the wizard). It never reads the file's contents (no import temptation), never deletes it (never-silently-delete). Surfacing via `SetupResult` keeps `runSetup` side-effect-pure apart from its declared writes; the console binding owns the logging, matching the existing `PromptPort`/edge discipline.

### AD-5 — Gitignore seam: extract the **full** `mergeMissingLines` semantics into `src/util/append-lines.ts`; `init` migrates to it in this change

**Decided.** New shared util:

```ts
// src/util/append-lines.ts
export interface AppendLinesResult {
  /** true iff this call changed the file's bytes. */
  changed: boolean;
  /** The file's bytes before this call (null if the file did not exist) — captured atomically with the merge decision, for rollback tracking. */
  original: Buffer | null;
}

/**
 * Ensures every non-empty line of `content` is effectively present in
 * `filePath`, appending only what is missing. Byte-exact (raw Buffer
 * comparison, never decodes the existing file as UTF-8), preserves the
 * file's own EOL (LF/CRLF) for appended lines, negation-aware
 * (gitignore last-match-wins: a trailing `!line` un-ignores, so a
 * negated entry is treated as missing and re-appended), never modifies
 * or reorders existing lines. Creates the file (with `content`) when
 * absent.
 */
export function appendMissingLines(filePath: string, content: string): Promise<AppendLinesResult>;
```

The implementation is `init.ts`'s `mergeMissingLines` body **moved verbatim** minus the `ScaffoldTracker` coupling: the util captures `original` itself and returns it, so the caller that needs rollback (init) gets the exact pre-write bytes without the util knowing about trackers. `init.ts`'s `mergeMissingLines(filePath, content, tracker)` becomes a thin wrapper: call the util; if `original !== null` push `{ path, original }` into `tracker.mergedFiles`; return `changed`. Behavior is byte-identical (init's tests, which pin the N7 semantics through `initVault`, keep passing unchanged). Setup calls the util directly with the one-line content `"supermemory.json"`.

**Rationale.**

- The proposal's "minimal append-if-missing helper for setup" option would re-learn, in a second implementation, exactly the lessons `add-m1-core` remediation N7 paid for: CRLF preservation, negation-aware effective-presence, and raw-byte safety for non-UTF-8 content. Those hazards apply identically to a project `.gitignore` (a teammate on Windows, a repo with `!supermemory.json` negations, Latin-1 bytes in comments). The spec's setup requirement ("existing lines MUST NOT be modified or reordered", idempotent) *is* the N7 contract.
- **`init` migrates now**, not later: leaving two copies of a byte-critical algorithm is the actual hazard, and the migration is mechanical (two call sites in `init.ts`, wrapper shape, existing tests as the guard). Deferring buys nothing and risks drift.
- Named `append-lines.ts` (not `gitignore-…`) because `init` uses the same routine for `.gitattributes`.
- Scope honesty: this is the smallest thing that serves both callers *correctly* — a smaller helper would be smaller but wrong under N7's edge cases.

### AD-6 — Loader shape and home: `src/config/project-config.ts` owns loader, discovery, chain resolver, and author extraction; the setup.ts name collision resolves by renaming setup's private helper

**Decided.** New module `src/config/project-config.ts` — the `project-config` capability's code home (the delta spec assigns the chain to this capability; the module boundary mirrors the spec boundary):

```ts
export const PROJECT_CONFIG_FILENAME = "supermemory.json";
export const EXAMPLE_CONFIG_FILENAME = "supermemory.example.json";
export const EXAMPLE_CONFIG_CONTENT = '{\n  "vault": "/absolute/path/to/your/vault"\n}\n';

/** Flat per-project shape (spec: vault REQUIRED absolute; author OPTIONAL). */
export interface ProjectConfig {
  vault: string;
  author?: { name: string; email: string };
}

/** Nearest enclosing Git work-tree root from `basePath` (`.git` dir or file); undefined outside any work tree. Pure fs walk, no subprocess. */
export function findProjectRoot(basePath: string): string | undefined;

/** Absolute path of the project config for a launch location; undefined outside any work tree. */
export function projectConfigPath(basePath: string): string | undefined;

/**
 * Load and validate the project config. FAIL-SAFE (spec-frozen): absent
 * file, unreadable file, JSON parse error, non-object root, missing /
 * non-string / non-absolute `vault` ⇒ `undefined` — resolution then
 * behaves exactly as if no file existed and ends in the pinned
 * NO_VAULT_CONFIGURED error. Never throws for file content. A malformed
 * optional `author` is dropped (vault still honored); unknown keys are
 * ignored.
 */
export function loadProjectConfig(basePath: string): Promise<ProjectConfig | undefined>;

/**
 * The project author as a CommitAuthor-compatible value, or undefined
 * when absent/malformed (name and email must both be non-empty strings).
 * Structurally typed ({ name, email }) — no import from sync/; it is
 * assignable to CommitAuthor by structure.
 */
export function projectAuthor(config: ProjectConfig | undefined): { name: string; email: string } | undefined;

/**
 * THE resolution chain (spec-frozen order): vaultFlag → SUPERMEMORY_VAULT
 * → project file at findProjectRoot(basePath) → AppError
 * NO_VAULT_CONFIGURED with the exact message
 * "No vault configured. Run: supermemory setup".
 */
export function resolveVaultPath(input: {
  vaultFlag?: string;
  env: EnvSource;
  basePath: string;
}): Promise<string>;
```

- **Why here and not `util/`:** the chain, the file format, and the author rule are *domain* logic — one capability, one module, exactly mirroring the spec's ownership statement. `util/` is for generic mechanics (`append-lines`, `errors`, `clock`); a vault-resolution chain with spec-pinned error bytes is not generic.
- **`resolveVaultPath` moves out of `src/mcp/server.ts`** (its current home is the original smell: a CLI-shared resolver living inside the MCP composition root, forcing `sync.ts`/`resolve.ts` to import *from* `mcp/server.ts` — an inverted dependency this change fixes as a side effect). The public name `resolveVaultPath` is kept (specs, tests, and docs reference it); it takes an options object (clearer than a growing positional list; the third `basePath` parameter would already be ambiguous positionally next to `vaultFlag`).
- **The setup.ts name collision** (`setup.ts` has a private `resolveVaultPath(raw)` that tilde-expands *user prompt input* — semantically unrelated to the chain) resolves by **renaming setup's private helper to `expandVaultInput(raw: string): string`**, a name that says what it does. The shared chain keeps the spec-referenced name; the private input-normalizer gets a purpose-true one. No re-export shims: `server.ts` deletes its copy, and all consumers import from `config/project-config.js` directly.
- **Fail-safe parse semantics** (spec-frozen; overrides the proposal's "distinct error naming the file" lean — the delta spec's `Corrupt file fails safe to unconfigured` scenario decided this): every malformed case collapses to `undefined` ⇒ pinned error. Rationale beyond spec obedience: `setup`'s fresh-write rerun is the correct remediation for *every* malformed-file case (a distinct error would add a code, a second remediation path, and no better action), and this mirrors the existing corrupt-global-config precedent (`loadGlobalConfig` returns empty on parse error). No stderr diagnostic either — `serve`'s stdout is the MCP protocol and a stderr line is noise the user can't act on beyond what the pinned message already says.
- **Consumer rewiring** (the mechanical diff, three files):
  - `server.ts`: delete `resolveVaultPath`, `authorFromConfig`, and the `global-config` import; `ServeOptions` gains `basePath?: string` (defaults to `process.cwd()` inside `serveVault` — `serve` has no commander edge, so the default-in-composition-root is the pragmatic edge, noted here); `vaultPath = await resolveVaultPath({ vaultFlag: opts.vaultFlag, env, basePath })`; `author = projectAuthor(await loadProjectConfig(basePath))`.
  - `sync.ts` / `resolve.ts`: `SyncCommandInput` and `ResolveCommandInput` gain a **required** `basePath: string`; the commander action (the true ambient edge) passes `process.cwd()`; the runners stay pure and testable. Same vault/author swaps as `serveVault`.
  - Accepted wrinkle, documented: `resolveVaultPath` and the author lookup each read the tiny project file once per boot (two reads). Fail-safe parsing makes the two reads independently valid-or-undefined, so the only theoretical inconsistency (file edited mid-boot between the two reads) degrades to either a valid vault or the pinned error — no corruption path. Not worth a combined return type.
- **`src/config/env.ts`:** delete the `configDir` entry from `ENV_KEYS` (dead once global config dies); `vault`, `logLevel`, `syncIntervalMinutes`, `debounceSeconds` stay.
- **Deleted:** `src/config/global-config.ts` and `test/config/global-config.test.ts`, with all four consumer imports (`server.ts`, `sync.ts`, `resolve.ts`, `setup.ts`).

### AD-7 — CommitAuthor flow: three call sites swap source; the engine seam is untouched

**Decided.** The engine already consumes author as an injected dep (`createSyncEngine({ author: deps.author, … })`, ~8 internal uses of `deps.author` — `sync/engine.ts:129` and call sites). The only change is who computes it. Each of the three composition points replaces

```ts
const globalConfig = await loadGlobalConfig(env);
const author = authorFromConfig(globalConfig);        // server.ts:185, sync.ts, resolve.ts — dies
```

with

```ts
const author = projectAuthor(await loadProjectConfig(basePath));   // undefined ⇒ degradation
```

and passes it exactly where it goes today: `createVaultSyncStack({ …, author })` in `serveVault`/`runSyncCommand`, and `runResolve({ …, author })` in `runResolveCommand`. `authorFromConfig` is deleted with the global config.

**Rationale.** The degradation the sync-ladder delta requires ("no `author` ⇒ vault's inherited Git identity, commits still proceed") already exists as the `author?: CommitAuthor` optional dep flowing into the git client — `undefined` means the git client lets the vault repo's own config speak. `projectAuthor` returns `undefined` whenever `author` is absent *or* malformed (only one of name/email present), so the degradation is the single well-tested path for every non-configured shape. Defining the return type locally (`{ name: string; email: string }`) keeps `config/` free of `sync/` imports — structural assignability to `CommitAuthor` is guaranteed and asserted by the compiler at the three call sites. `engine.ts` and `git.ts` have **zero diff**.

---

## 2. Module layout

New/changed files (★ new, ✎ modified, ✖ deleted):

```
src/
├─ config/
│  ├─ project-config.ts        ★ AD-6: filenames + example template constant,
│  │                              ProjectConfig, findProjectRoot, projectConfigPath,
│  │                              loadProjectConfig (fail-safe), projectAuthor,
│  │                              resolveVaultPath (the chain)
│  ├─ env.ts                   ✎ ENV_KEYS loses `configDir`
│  └─ global-config.ts         ✖ deleted (GlobalConfig, loadGlobalConfig,
│                                 saveGlobalConfig, configDirFor, resolveDefaultVault)
├─ util/
│  └─ append-lines.ts          ★ AD-5: appendMissingLines (byte-exact, CRLF-preserving,
│                                 negation-aware) — extraction of init's mergeMissingLines
├─ cli/commands/
│  ├─ setup.ts                 ✎ AD-2: guards (findProjectRoot + home check,
│  │                              SETUP_LOCATION_REFUSED), expandVaultInput rename,
│  │                              writes at work-tree root (fresh supermemory.json,
│  │                              appendMissingLines .gitignore, writeIfAbsent example),
│  │                              legacy hint via SetupResult; env param dropped;
│  │                              io = { basePath, homeDir } injected
│  ├─ init.ts                  ✎ AD-5: mergeMissingLines becomes a thin wrapper over
│  │                              appendMissingLines (byte-identical behavior)
│  ├─ sync.ts                  ✎ AD-6/7: required input.basePath; resolveVaultPath +
│  │                              projectAuthor from project-config; global-config import out
│  └─ resolve.ts               ✎ same as sync.ts
└─ mcp/
   └─ server.ts                ✎ AD-6/7: resolveVaultPath + authorFromConfig deleted
                                  (moved); ServeOptions.basePath?; serveVault rewires to
                                  project-config; global-config import out
```

Data flow (one picture):

```
agent project (git work tree)                vault (separate git repo)
┌──────────────────────────────┐             ┌─────────────────────────┐
│ supermemory.json   (gitignored, per-user)  │ .memory/rules.md …      │
│ supermemory.example.json (committed)       │ notes, index/           │
│ .gitignore  (one appended line)            │ .memory/config.yml      │
└──────────┬───────────────────┘             └──────────▲──────────────┘
           │ read at boot: findProjectRoot(basePath)   │ writes via sync engine
           ▼                                           │  (author = projectAuthor
serve / sync / resolve ── resolveVaultPath ────────────┘   else vault git identity)
  (flag → SUPERMEMORY_VAULT → project file → pinned error)

setup (interactive): guards → ≤5× validateBoot loop → author prompts (default
  readGitIdentity(vault)) → confirm → write 3 artifacts at work-tree root
```

---

## 3. Runtime flows (sequence diagrams)

### 3.1 Boot resolution chain — identical for `serve`, `sync`, `resolve`

```mermaid
sequenceDiagram
    autonumber
    participant Edge as CLI action / serveVault (ambient edge)
    participant Chain as resolveVaultPath (config/project-config)
    participant Env as EnvSource
    participant Proj as loadProjectConfig + findProjectRoot
    participant Boot as validateBoot (UNCHANGED)

    Edge->>Chain: { vaultFlag?, env, basePath = process.cwd() }
    alt --vault flag set
        Chain-->>Edge: flag path (highest precedence)
    else SUPERMEMORY_VAULT set
        Chain->>Env: readString(SUPERMEMORY_VAULT)
        Env-->>Chain: value
        Chain-->>Edge: env path
    else project file
        Chain->>Proj: loadProjectConfig(basePath)
        Proj->>Proj: walk up: nearest ancestor-or-self with .git (dir or file)
        alt root found AND supermemory.json parses with absolute vault
            Proj-->>Chain: { vault, author? }
            Chain-->>Edge: project vault path
        else no root / file absent / corrupt / vault not absolute
            Proj-->>Chain: undefined (fail-safe)
            Chain-->>Edge: AppError NO_VAULT_CONFIGURED<br/>"No vault configured. Run: supermemory setup" (byte-pinned)
        end
    end
    Edge->>Boot: validateBoot(vaultPath) — the five checks, unchanged
    Note over Edge,Boot: author (serve/sync/resolve) = projectAuthor(loadProjectConfig(basePath));<br/>undefined ⇒ engine commits inherit the vault's git identity (AD-7)
```

### 3.2 `supermemory setup` — guards, bounded vault loop, atomic-after-confirm writes

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant Cmd as setup command (edge)
    participant S as runSetup(prompts, { basePath, homeDir })
    participant G as Guards
    participant P as PromptPort (scripted in tests)
    participant FS as fs writes (work-tree root)

    Cmd->>S: { basePath: process.cwd(), homeDir: os.homedir() }
    S->>G: basePath === homeDir ?
    alt home root
        G-->>Cmd: AppError SETUP_LOCATION_REFUSED (names dir; nothing written)
    else findProjectRoot(basePath) ?
        alt no work tree
            G-->>Cmd: AppError SETUP_LOCATION_REFUSED (names dir; nothing written)
        else root found (subdir launch ⇒ root, not cwd)
            Note over S: legacy hint: existsSync(homeDir/.config/supermemory/config.json)
            loop ≤ MAX_VAULT_ATTEMPTS = 5
                S->>P: "Vault path (a git repository with .memory/rules.md):"
                User-->>P: answer
                S->>S: expandVaultInput(answer) → validateBoot
                alt valid
                    S-->>S: vault locked, break
                else invalid
                    S->>P: "{error} Try another path?"
                    User-->>P: no ⇒ abort, nothing written
                end
            end
            S->>P: author name/email — defaults readGitIdentity(vault)
            S->>P: "Write supermemory.json (vault {vault}, author {name} <{email}>)?"
            User-->>P: confirm
            S->>FS: fresh write {root}/supermemory.json (flat; no merge)
            S->>FS: appendMissingLines({root}/.gitignore, "supermemory.json")
            S->>FS: writeIfAbsent {root}/supermemory.example.json (wx; placeholder bytes)
            S-->>Cmd: SetupResult { root, vault, author, legacyConfigPath? }
            Cmd->>User: completion log (+ one legacy-hint line when present)
        end
    end
```

---

## 4. Exact contracts this design pins (for the tasks/apply phases)

1. **Pinned error bytes** (unchanged, byte-tested): `No vault configured. Run: supermemory setup` with code `NO_VAULT_CONFIGURED`, hint naming `--vault`/`SUPERMEMORY_VAULT` as escape hatches.
2. **New error code** `SETUP_LOCATION_REFUSED` + the two message templates in AD-2.
3. **Project file serialization**: `JSON.stringify({ vault, ...(author ? { author } : {}) }, null, 2) + "\n"` — 2-space indent, trailing newline (same style as the old `saveGlobalConfig`).
4. **Example file bytes**: the pinned template in AD-3 (`EXAMPLE_CONFIG_CONTENT`).
5. **Gitignore append content**: exactly `supermemory.json` (one line), through `appendMissingLines`.
6. **Setup completion log**: no string may contain "global config"; the confirm message reads `Write supermemory.json in {root} (vault {vault}, author "{name} <{email}>")?`.

---

## 5. What does NOT change (explicit)

- **Vault-side team tunables**: `.memory/config.yml` (`src/config/vault-config.ts`, `resolveSyncTunables`, env > config.yml > rules `git:` > built-ins) — untouched; the vault remains a separate repo whose committed policy travels with it.
- **Rules parsing** (`src/rules/*`, format_version contract), templates, note-type validation.
- **Sync engine internals** (`src/sync/engine.ts`, `git.ts`, `scheduler.ts`, `lock.ts`): `deps.author` is the same seam, now fed from the project file; conflict ladder, commit grammar, trailers, secrets lint, pidfile lock — all untouched.
- **Tool schemas and catalog**: the six M1 tools, their zod schemas, descriptions, the `rules://current` resource, MCP protocol surface, `StdioServerTransport`, scheduler wiring.
- **Boot validation**: the five checks and every existing actionable message.
- **`supermemory init`**: behavior byte-identical; only its internal `mergeMissingLines` delegates to the shared util (AD-5).
- **Env knobs that survive**: `SUPERMEMORY_VAULT`, `SUPERMEMORY_LOG_LEVEL`, `SUPERMEMORY_SYNC_INTERVAL_MINUTES`, `SUPERMEMORY_DEBOUNCE_SECONDS` (only `SUPERMEMORY_CONFIG_DIR` dies).
- **The error shape** (`AppError`, `ERROR_CODES`) — one code added (`SETUP_LOCATION_REFUSED`), none removed.

---

## 6. Test migration plan

**The seam pattern (one sentence):** the injectable cwd is an explicit `basePath` parameter on `resolveVaultPath`, `ServeOptions`, `SyncCommandInput`, `ResolveCommandInput`, and setup's `io.basePath`/`io.homeDir`; ambient `process.cwd()`/`os.homedir()` appear **only** in commander action handlers and `serveVault`'s documented default. No test chdirs; no test mutates `process.env` for discovery.

**New fixture helper — `test/helpers/project.ts`:**

```ts
makeProjectDir(opts?: {
  config?: unknown;       // serialized to {root}/supermemory.json when provided
  example?: string;       // pre-placed committed example (byte-assert its survival)
  gitignore?: string;     // pre-placed .gitignore content (LF or CRLF)
  nested?: string;        // create + return a subdirectory (subdir-launch tests)
}): Promise<TestProject>  // { root, subdir?, cleanup() } — mkdtemp + `git init` (the .git marker discovery needs)
```

File-by-file plan:

| Test file | Change |
|---|---|
| `test/config/project-config.test.ts` **(new)** | Loader fail-safe matrix: absent / unreadable / invalid JSON / non-object / `vault` missing / non-string / **relative** / author half-present (dropped, vault honored) / unknown keys ignored. `findProjectRoot`: at root, from subdirectory, **nested work trees → nearest root wins**, no `.git` anywhere → `undefined`, `.git` **file** marker (linked worktree shape). `resolveVaultPath` precedence trio + `NO_VAULT_CONFIGURED` bytes. `projectAuthor` both-present / absent / malformed. |
| `test/util/append-lines.test.ts` **(new)** | N7 regression suite ported to the util: CRLF preservation, negation (`!line`) re-append, non-UTF-8 byte safety, idempotent no-write returns `changed:false`, `original` capture, file-created-when-absent. |
| `test/mcp/server.test.ts` | Resolution block rewires: import `resolveVaultPath` from `config/project-config.js`; flag/env precedence tests keep (drop `SUPERMEMORY_CONFIG_DIR` from `fakeEnv`); the global-config fallback test becomes the **project-file** test (`makeProjectDir({ config: { vault } })`, `basePath: root`) plus a **subdir launch** case; the unconfigured tests use an empty tmp dir + `fakeEnv({})` — **the byte-exact literal pin (~:80) stays verbatim** (`"No vault configured. Run: supermemory setup"`); only its fixture and the import change. `authorFromConfig` tests move out (replaced by `projectAuthor` unit tests above). |
| `test/cli/commands/setup.test.ts` | `envWith(configDir)` and global-config assertions deleted. Fixtures: project repo + vault repo (`simpleGit`, rules.md) per current style; `scriptedPort` unchanged. New cases: home-root refusal (io.homeDir === basePath fixture), non-work-tree refusal, **subdir invocation writes at root**, flat-file content assert (incl. author default from `readGitIdentity`), gitignore append/idempotency/other-lines-byte-unchanged (port the CRLF case), example created-when-absent (placeholder bytes, no author fields anywhere) / **never overwritten** (pre-place, byte-compare), five-invalid-attempts abort leaves **zero** artifacts, rerun-replaces-file (stale keys gone), legacy hint surfaced iff legacy file exists, `SETUP_LOCATION_REFUSED` message bytes. |
| `test/helpers/env.ts` (+ `helpers/env.test.ts`, `p1/gate.test.ts`) | `withTestEnv` loses `configDir`, keeps `vault` only. Gate test's global-config scenario (asserting no real `~/.config` writes) is deleted with the module — its job is inherited by the project-dir fixture tests (loaders only touch `basePath` trees). The env-restore test keeps `SUPERMEMORY_VAULT`. |
| `test/config/global-config.test.ts` | **Deleted** with the module. |
| `test/config/env.test.ts` | Drop `configDir` from the `ENV_KEYS` coverage assertions. |
| `test/cli/commands/init.test.ts` | **No behavioral change** — N7 pins keep passing through the wrapper. (The private-symbol tests don't exist; `mergeMissingLines` was module-private.) |
| `test/cli/commands/sync.test.ts`, `resolve.test.ts` (where present) | Mechanical: add `basePath: fixture.root` to runner inputs; assertions unchanged. |

---

## 7. RFC edit plan (executed atomically by the apply phase — one work unit)

`docs/RFC.md` (currently Draft v1.2). Touchpoints located by grep; archived change docs stay untouched (historical records).

| # | RFC location (current line) | Edit |
|---|---|---|
| 1 | Header `:3` | Status → `Draft v1.3 (per-project supermemory.json replaces the global config; legacy .memory/local.json superseded)`. |
| 2 | §1 `:36-37` | "…lives in the vault repo or in a tiny global config of pointers" → "…in the vault repo or in a tiny per-project config file". |
| 3 | §3 diagram `:79-84` | Replace the `~/.config/supermemory/config.json / pointers + identity` box with `AGENT PROJECT / supermemory.json (gitignored) / vault pointer + author identity`; arrow: MCP reads it at boot from the nearest work-tree root. |
| 4 | §3 Invariant 2 `:106-109` | Re-anchor: "Outside the vault it writes exactly: the gitignored `supermemory.json` (plus the optional committed `supermemory.example.json` and one `.gitignore` line) **inside the agent project**, and logs. No notes, no copies, no telemetry, no shadow stores." |
| 5 | §4.1 layout `:142` | Delete the `local.json # per-user author identity (gitignored)` line — formally superseded: per-user identity lives in the agent project's `supermemory.json` (never implemented in M1; no migration). |
| 6 | §5.1 `:328-329` | "Both modes share the same global registry (`vaults` in the global config)" → M2 re-anchors multi-vault on per-project `supermemory.json` files; there is no global registry. Keep `projects_list`/`vault_register` as M2 design intent with registry wording adjusted. |
| 7 | §6.3 `:423` | "(from `.memory/local.json` or inherited git config)" → "(from the project config's `author`, falling back to inherited Git identity)" — verbatim with the sync-ladder delta. |
| 8 | §7.2 `:479-498` | Walkthrough rewrite: `setup` runs **inside the agent project** (not the vault clone); bullets: guards, validated vault loop, author (defaults from vault git config), writes `./supermemory.json` + gitignore line + example-when-absent; `install --client` / `vault add` lines marked M2 and their "same global config" wording removed. Keep the "server is never interactive / pinned error" paragraph (still true). |
| 9 | §7.5 `:526-527` | "Global config survives" → "The per-project `supermemory.json` survives updates (it lives in the project); `npx supermemory@latest` remains a complete update." |
| 10 | §8 `:535-537` | Chain sentence → "`serve --vault <path>` serves exactly one vault. With no flag: `SUPERMEMORY_VAULT` env → `supermemory.json` at the nearest Git work-tree root of the launch directory." |
| 11 | §8 `:539-547` | Replace the `~/.config/supermemory/config.json` jsonc block with two blocks: the gitignored `supermemory.json` (flat `vault` + optional `author`) and the committed `supermemory.example.json` (placeholder vault, never author). |
| 12 | §8 `:557` | Delete the `SUPERMEMORY_CONFIG_DIR` table row. |
| 13 | §8 `:560` | Drop the "`~/.config/supermemory/.env`" loading sentence (never implemented); keep vault-committed `config.yml` + source-repo `.env` dogfooding note. |
| 14 | §10 `:631` | No text change needed — "outside §3's two exceptions" tracks the re-worded invariant 2; verify during apply. |
| 15 | §12 | No change (M1 bullet "init, setup, serve, sync" remains true; this change is the corrective re-anchor M2 builds on — recorded in the change archive, not the milestone list). |

Also under this work unit (success-criteria sweep): no occurrence of `SUPERMEMORY_CONFIG_DIR` or user-visible "global config" strings anywhere in code, tests, or docs after the sweep.

---

## 8. Implementation sequencing (input for the tasks phase)

Dependency-ordered work units (strict TDD per phase config; each unit RED→GREEN→REFACTOR):

1. **W1 — append-lines extraction** (AD-5): util + ported N7 tests + init wrapper. No behavior change; independently landable.
2. **W2 — project-config module** (AD-1/AD-6): `findProjectRoot`, loader, `projectAuthor`, `resolveVaultPath`, `ENV_KEYS` trim + full unit test file. No consumers yet.
3. **W3 — consumer rewiring + global-config deletion** (AD-6/7): server/sync/resolve swaps, `server.test.ts` migration, delete `global-config.ts` + its tests, `withTestEnv` trim. Depends on W2.
4. **W4 — setup rework** (AD-2/3/4): guards, root writes, example, legacy hint, message updates, `setup.test.ts` rewrite. Depends on W1+W2.
5. **W5 — RFC + docs sweep** (§7). Depends on W3/W4 semantics being final.

**Delivery forecast** (for the delivery gate; `ask-on-risk` per session preflight — not decided here): W1 ~120, W2 ~350, W3 ~300, W4 ~450, W5 ~200 changed lines ⇒ budget risk **High**; natural chain seams exist (W1→W2→W3→W4→W5). The flow pauses at the delivery gate per preflight; no chain strategy is invented in this phase.

---

## 9. Design-level risks

1. **Walk-up discovery cost/edge cases** — bounded stat walk; `.git` file markers (linked worktrees) treated as roots, and setup/resolution share one `findProjectRoot` so they cannot disagree. Pinned by W2 tests (nested trees, no-root).
2. **Home-as-git-repo guard bypass** — impossible by ordering (home check first, AD-2); test pins the scenario even with a `.git` present at home.
3. **Example-file TOCTOU** — `wx` exclusive create + `isEexist` tolerance (init's proven pattern).
4. **Two project-file reads per boot** (vault + author) — accepted and documented (AD-6); fail-safe parsing bounds the worst case to valid-or-pinned-error.
5. **Over-refusal** — denylist stays exactly the two spec-mandated checks; a real repo under `/tmp` still passes (AD-2 rationale).
6. **Message drift** — every pinned string in §4 is byte-tested in W3/W4; the `NO_VAULT_CONFIGURED` literal pin keeps its verbatim assertion with a changed fixture only.
