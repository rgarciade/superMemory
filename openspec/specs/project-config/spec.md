# Project Config Specification

## Purpose

Per-project, gitignored local configuration (`supermemory.json`) at the agent-project root: which vault this project uses and who the human author is. This capability owns the single vault resolution chain shared by `serve`, `sync`, and `resolve`, the project-aware `setup` wizard that writes the file, and the committed `supermemory.example.json` onboarding template. It replaces the removed per-user global config (change `add-project-config`); there is no global vault or author source anymore.

## Requirements

### Requirement: Project config file format and location

The system SHALL read per-project configuration from a file named `supermemory.json` located at the agent-project root. The file MUST be a flat JSON object with exactly this shape: `vault` (a non-empty absolute filesystem path, REQUIRED) and `author` (an object with `name` and `email` strings, OPTIONAL). Because `vault` is absolute, the file MUST resolve to the same vault regardless of the cwd the process is later launched from. The file is per-user, machine-local state: `setup` MUST keep it out of version control (see the gitignore requirement). The system MUST NOT read any global config location (for example `~/.config/supermemory/config.json`) for vault or author decisions.

A file that cannot be parsed as JSON, or whose `vault` value is missing or not an absolute path, SHALL be treated as unconfigured: resolution behaves exactly as if the file were absent and ends in the pinned unconfigured error. The system MUST NOT crash with a parse error, MUST NOT partially honor a malformed file, and MUST NOT silently invent defaults from a broken file.

#### Scenario: Happy-path save and read

- GIVEN `setup` ran in the agent project `/Users/me/apps/todo-app` and wrote `/Users/me/apps/todo-app/supermemory.json` containing `{ "vault": "/Users/me/vaults/notes", "author": { "name": "Raul", "email": "raul@example.com" } }`
- WHEN `serve` starts in `/Users/me/apps/todo-app` with no `--vault` flag and no `SUPERMEMORY_VAULT` set
- THEN the vault used is `/Users/me/vaults/notes` and no error occurs

#### Scenario: Corrupt file fails safe to unconfigured

- GIVEN `/Users/me/apps/todo-app/supermemory.json` exists but contains invalid JSON (for example a truncated `{ "vault": `)
- WHEN `serve` starts in that directory with no flag and no `SUPERMEMORY_VAULT`
- THEN startup fails with exactly `No vault configured. Run: supermemory setup` and does not crash with a JSON parse error

#### Scenario: Non-absolute vault path is treated as unconfigured

- GIVEN `supermemory.json` contains `{ "vault": "../vaults/notes" }` (a relative path)
- WHEN any surface resolves the vault with no flag and no `SUPERMEMORY_VAULT`
- THEN the relative path is not used and the failure is the same pinned unconfigured error as a missing file

### Requirement: One resolution chain shared by every surface

The `serve` server, the `sync` command, and the `resolve` command SHALL all resolve the vault through the same chain, first match wins:

1. the `--vault` launch flag;
2. the `SUPERMEMORY_VAULT` environment variable;
3. the project config file `supermemory.json` at the project root, resolved from the launch location (tests inject the base path explicitly rather than depending on process cwd);
4. otherwise fail with error code `NO_VAULT_CONFIGURED` and the exact message `No vault configured. Run: supermemory setup`.

No surface MAY consult any other source, and no surface MAY skip a higher-precedence source. `supermemory setup` remains the remediation the pinned message promises.

#### Scenario: Flag overrides env and file

- GIVEN `supermemory.json` names `/Users/me/vaults/notes`, `SUPERMEMORY_VAULT=/Users/me/vaults/personal`, and the command is run with `--vault /Users/me/vaults/work`
- WHEN `serve`, `supermemory sync`, or `supermemory resolve` starts
- THEN the vault used is `/Users/me/vaults/work` on every surface

#### Scenario: Env overrides file

- GIVEN `supermemory.json` names `/Users/me/vaults/notes` and `SUPERMEMORY_VAULT=/Users/me/vaults/personal` with no `--vault` flag
- WHEN any surface starts
- THEN the vault used is `/Users/me/vaults/personal`

#### Scenario: Project file is the last configured source

- GIVEN `supermemory.json` names `/Users/me/vaults/notes`, with no flag and no `SUPERMEMORY_VAULT`
- WHEN any surface starts
- THEN the vault used is `/Users/me/vaults/notes`

#### Scenario: Nothing configured yields the pinned error verbatim

- GIVEN a directory with no `supermemory.json`, no `SUPERMEMORY_VAULT`, and no `--vault` flag
- WHEN any surface starts
- THEN it fails fast with exactly `No vault configured. Run: supermemory setup`, serves nothing, and runs no sync

### Requirement: Author resolution and degradation

Note-commit authorship SHALL be resolved from the project config's `author` (name and email) when the key is present. When the project config has no `author` key, the system SHALL degrade to the vault repository's inherited Git identity — the same documented behavior as before this change — and MUST NOT block writes or sync because authorship is unconfigured.

#### Scenario: Commit uses the project config author

- GIVEN `supermemory.json` contains `"author": { "name": "Raul", "email": "raul@example.com" }`
- WHEN a note write is committed in the vault
- THEN the commit's Git author is `Raul <raul@example.com>`

#### Scenario: Author absent degrades to inherited Git identity

- GIVEN `supermemory.json` contains only `{ "vault": "/Users/me/vaults/notes" }` with no `author` key, and the vault's Git config defines `user.name=Dogfooder` / `user.email=dog@example.com`
- WHEN a note write is committed in the vault
- THEN the commit proceeds without error and its Git author is the vault's `Dogfooder <dog@example.com>`

### Requirement: Setup guards refuse meaningless locations

`supermemory setup` SHALL verify it is running at a sensible location before any prompt or write. It MUST refuse — before prompting — when the launch location is outside any Git work tree, and when it is the user's home root (for example `/Users/me`), regardless of whether that directory happens to be a repository. Each refusal MUST be actionable: it names the offending directory and states what setup requires. A refusal MUST write nothing: no `supermemory.json`, no `.gitignore` change, no `supermemory.example.json`.

#### Scenario: Home root is refused

- GIVEN the user's home is `/Users/me` and `supermemory setup` is launched there
- WHEN the guards run
- THEN setup exits nonzero with an error naming `/Users/me` and explaining it must run inside an agent project's Git work tree, and no files are written

#### Scenario: Outside any work tree is refused

- GIVEN `/tmp/scratch` is not inside any Git work tree and `supermemory setup` is launched there
- WHEN the guards run
- THEN setup exits nonzero with an error naming `/tmp/scratch`, and `supermemory.json` does not exist afterward

#### Scenario: A real agent project passes the guards

- GIVEN `/Users/me/apps/todo-app` is inside a Git work tree and is not the home root
- WHEN `supermemory setup` is launched there
- THEN the guards pass and setup proceeds to the vault prompt

### Requirement: Setup wizard validates the vault before writing

Setup's vault prompt SHALL reuse boot validation (the five checks) in a bounded loop of at most 5 attempts (`MAX_VAULT_ATTEMPTS = 5`). After each failed attempt the user SHALL be offered another path. A validated path proceeds to the author step. After the fifth failed attempt setup MUST abort with an actionable error and MUST have written nothing: no `supermemory.json`, no `.gitignore` change, no example file.

#### Scenario: Failed attempt re-prompts, valid path proceeds

- GIVEN the user first answers `/not/a/vault`, which fails boot validation, then answers `/Users/me/vaults/notes`, which passes
- WHEN the vault loop runs
- THEN the first answer triggers a re-prompt offering another path, and the second answer proceeds to the author step

#### Scenario: Five failures abort without writing anything

- GIVEN the user answers with an invalid path five times
- WHEN the fifth attempt fails
- THEN setup aborts with an actionable error and `/Users/me/apps/todo-app/supermemory.json`, the `.gitignore` entry, and `supermemory.example.json` are all absent afterward

### Requirement: Setup writes fresh, never merges

On success, `setup` SHALL write `./supermemory.json` at the project root as a fresh write of the flat shape — the validated `vault` path and the answered `author` — and MUST NOT merge with any pre-existing file: keys from a previous file (including unknown or stale keys) do not survive the rewrite. The author prompt SHALL default from the vault repository's Git identity. Setup MUST keep the file out of version control by appending the line `supermemory.json` to the project `.gitignore` only when that line is missing; existing `.gitignore` lines MUST NOT be modified or reordered.

#### Scenario: Successful setup writes the flat file

- GIVEN setup runs in `/Users/me/apps/todo-app`, the vault `/Users/me/vaults/notes` passes validation, and the vault's Git identity is `Raul <raul@example.com>`
- WHEN the user confirms
- THEN `/Users/me/apps/todo-app/supermemory.json` exists containing `vault: /Users/me/vaults/notes` and `author` name `Raul` / email `raul@example.com` in the flat shape, and `.gitignore` lists `supermemory.json`

#### Scenario: Author prompt defaults from the vault's Git identity

- GIVEN the validated vault's Git config defines `user.name=Raul` / `user.email=raul@example.com`
- WHEN setup reaches the author prompt
- THEN the prompt is prefilled with `Raul` and `raul@example.com` and accepting the default writes that identity

#### Scenario: Rerun replaces the file entirely

- GIVEN `supermemory.json` already exists with `{ "vault": "/old/vault", "stale": true }`
- WHEN setup reruns successfully with vault `/Users/me/vaults/notes`
- THEN the file contains exactly the new flat content for `/Users/me/vaults/notes` and neither `/old/vault` nor the `stale` key remains

#### Scenario: Gitignore line is appended when missing

- GIVEN the project `.gitignore` exists without a `supermemory.json` line and contains other entries such as `node_modules/`
- WHEN setup completes
- THEN `supermemory.json` appears as a new line and every pre-existing entry, including `node_modules/`, is byte-unchanged

#### Scenario: Gitignore append is idempotent

- GIVEN the project `.gitignore` already lists `supermemory.json`
- WHEN setup is run a second time and completes successfully
- THEN `.gitignore` contains exactly one `supermemory.json` line and its other content is unchanged

### Requirement: Example template file semantics

`supermemory.example.json` at the project root is the committed onboarding template for teammates. It SHALL contain a vault reference and SHALL NEVER contain any author identity, because the file is shared while identity is per-user. `setup` MAY create it when absent but MUST never overwrite an existing one: a committed or hand-edited `supermemory.example.json` MUST remain byte-identical after setup runs.

#### Scenario: Example file created when absent

- GIVEN `/Users/me/apps/todo-app` has no `supermemory.example.json`
- WHEN setup completes successfully
- THEN `supermemory.example.json` exists, contains a vault reference, and contains no `author` key or author fields anywhere in the file

#### Scenario: Example file is never overwritten

- GIVEN a committed `supermemory.example.json` with a team-specific placeholder vault reference
- WHEN setup runs again in that project
- THEN the file is byte-identical afterward — setup did not rewrite, merge, or "refresh" it
