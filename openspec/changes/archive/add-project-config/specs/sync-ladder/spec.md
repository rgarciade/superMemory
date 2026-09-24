# Delta for Sync Ladder

## MODIFIED Requirements

### Requirement: Human authorship with trailer provenance

The engine SHALL always set the Git author of note commits to the human (from the project config file's `author` when present, falling back to the vault's inherited Git identity when the project config has no `author`), so `git blame` shows people. Agent/client provenance SHALL be recorded in commit trailers (for example `Via:` and `Spec:`), never in the author identity. The author source, its file format, and the fallback are owned by the `project-config` capability; the engine consumes the resolved identity and MUST NOT read `.memory/local.json` or any global config.
(Previously: the author source was cited as `.memory/local.json` or inherited Git config — `.memory/local.json` was never implemented; the project config file replaces it as the primary source, with the same inherited-Git-identity fallback.)

#### Scenario: Agent-driven save commits as the human

- GIVEN a note saved through an agent via the MCP server, with `supermemory.json` declaring `"author": { "name": "Raul", "email": "raul@example.com" }`
- WHEN the engine commits it
- THEN the Git author is `Raul <raul@example.com>`, and the commit message carries trailers naming the agent/client and the linked spec

#### Scenario: Project config without author degrades to inherited Git identity

- GIVEN `supermemory.json` declares only a `vault` and no `author`, and the vault's Git config defines `user.name=Dogfooder` / `user.email=dog@example.com`
- WHEN the engine commits a note write
- THEN the commit proceeds with Git author `Dogfooder <dog@example.com>` and still carries the provenance trailers
