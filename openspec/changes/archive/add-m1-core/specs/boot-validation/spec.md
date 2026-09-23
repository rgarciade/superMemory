# Delta for Boot Validation

M1 scope: single-vault mode. Vault path validation shared by `setup` and `serve` (RFC §3 boot-time validation): five checks, fail-fast with actionable messages.

## ADDED Requirements

### Requirement: Boot-time vault validation

Before the server serves any tool or any vault operation runs, the system SHALL validate the resolved vault path and confirm that: (1) it is an existing directory; (2) it is a Git repository; (3) it contains `.memory/rules.md`; (4) it is not located inside the supermemory source repository; and (5) its `rules.md` declares a `format_version` supported by this build. All five checks MUST pass before any vault operation proceeds.

#### Scenario: Valid vault passes all checks

- GIVEN a directory that exists, is a Git repository, contains `.memory/rules.md`, lies outside the app source repository, and declares a supported `format_version`
- WHEN boot validation runs
- THEN all checks pass and the system proceeds to serve or operate on the vault

#### Scenario: Each failed check aborts startup

- GIVEN a vault path that fails exactly one check — a nonexistent directory, a non-Git directory, a Git repo without `.memory/rules.md`, a path inside the supermemory source repository, or an unsupported `format_version`
- WHEN boot validation runs
- THEN startup aborts and no tools are served for that vault

#### Scenario: Inside-app-repo guard blocks accidental private notes

- GIVEN a vault path located inside the supermemory source repository
- WHEN boot validation runs
- THEN startup aborts with an error explaining that the vault must not live inside the app repository, guarding against committing private notes to a public repo

### Requirement: Fail-fast actionable errors

Boot validation SHALL be fail-fast: the first failed check aborts startup with an error that names what failed and gives a concrete next action. The server MUST NOT serve a partial tool catalog or operate on an invalid vault. When no vault is configured at all, the system SHALL fail with `No vault configured. Run: supermemory setup`.

#### Scenario: Missing rules.md yields a located, actionable message

- GIVEN a valid Git repository that lacks `.memory/rules.md`
- WHEN boot validation runs
- THEN the error names the missing `.memory/rules.md` path and points to the command that creates it (vault init)

#### Scenario: Unconfigured environment yields the setup command

- GIVEN no vault path resolvable from the launch flag, `SUPERMEMORY_VAULT`, or global config
- WHEN the server or CLI starts
- THEN it fails fast with `No vault configured. Run: supermemory setup` and serves nothing
