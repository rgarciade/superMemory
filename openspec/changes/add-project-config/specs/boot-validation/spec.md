# Delta for Boot Validation

## MODIFIED Requirements

### Requirement: Fail-fast actionable errors

Boot validation SHALL be fail-fast: the first failed check aborts startup with an error that names what failed and gives a concrete next action. The server MUST NOT serve a partial tool catalog or operate on an invalid vault. When no vault is configured at all, the system SHALL fail with `No vault configured. Run: supermemory setup`. The set of vault sources and their precedence — the `--vault` launch flag, then `SUPERMEMORY_VAULT`, then the project config file `supermemory.json` — SHALL be owned by the `project-config` capability; boot validation validates whichever path that chain resolves and MUST NOT consult any other source (in particular, no global config).
(Previously: the unconfigured scenario's source list named "global config" as a resolution source; the chain is now flag → env → project config file, owned by `project-config`.)

#### Scenario: Missing rules.md yields a located, actionable message

- GIVEN a valid Git repository that lacks `.memory/rules.md`
- WHEN boot validation runs
- THEN the error names the missing `.memory/rules.md` path and points to the command that creates it (vault init)

#### Scenario: Unconfigured environment yields the setup command

- GIVEN no vault path resolvable from the launch flag, `SUPERMEMORY_VAULT`, or the project config file `supermemory.json` (for example, a project root where the file was never created)
- WHEN the server or CLI starts
- THEN it fails fast with exactly `No vault configured. Run: supermemory setup` and serves nothing
