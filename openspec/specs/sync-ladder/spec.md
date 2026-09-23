# Sync Ladder Specification

## Purpose

Single-vault, `auto` sync mode plus the always-available manual `sync` trigger (tool and CLI). One sync engine shared by CLI and MCP server (RFC §6): triggers, pull-rebase flow, commit grammar, conflict ladder, secrets lint, and locking. (Landed by change `add-m1-core`; M1 scope.)

## Requirements

### Requirement: Auto-mode sync triggers

In `auto` mode the engine SHALL sync on two triggers: a post-write debounce (default ~45 seconds, configurable via the rules' git settings) after each write, and an interval fallback (default 15 minutes) that skips cleanly — with no empty commits — when there is nothing to commit.

#### Scenario: Debounced push follows a write

- GIVEN the engine running in `auto` mode and the debounce configured
- WHEN a note is written and the debounce window elapses
- THEN the engine commits and pushes the write without any manual trigger

#### Scenario: Interval tick with a clean tree commits nothing

- GIVEN a vault with no pending writes
- WHEN the interval fallback fires
- THEN no commit is created and the engine returns to idle without error or noise

### Requirement: Manual sync trigger

The `sync` tool and the CLI `supermemory sync` SHALL run the full pull-commit-push cycle immediately, committing any pending writes, and SHALL remain available regardless of the engine's automatic behavior.

#### Scenario: CLI sync publishes pending writes on demand

- GIVEN pending local writes in the vault
- WHEN a human runs `supermemory sync`
- THEN the full cycle runs, the writes are committed and pushed, and the command reports the sync outcome

### Requirement: Pull-rebase flow with pull-before-write

Before every push the engine SHALL run `git pull --rebase --autostash` in the vault. When an agent updates an existing note, the engine SHALL pull the latest remote state before the write is applied, so edits always start from the latest known remote version.

#### Scenario: Uncommitted local work survives a sync

- GIVEN uncommitted local changes in the vault when a sync runs
- WHEN the pull-rebase with autostash executes
- THEN the sync completes and the previously uncommitted local changes are restored intact

#### Scenario: Edits build on the latest remote version

- GIVEN a note that exists both locally and on the remote, with the remote ahead
- WHEN an agent updates that note
- THEN the latest remote version is pulled before the edit is applied

### Requirement: Commit grammar derived from frontmatter

The engine SHALL create one commit per write event, with the header `note(<add|update|delete>): <type> "<title>" [<id>]` derived deterministically from the note's frontmatter — no LLM and no free text from the agent. Update commits SHALL include the meaningful change (for example, a status transition). Deriving the message from the same frontmatter SHALL always yield the identical message, making `git log --grep=<id>` a query interface.

#### Scenario: Addition commit matches the grammar

- GIVEN a new decision with title "FTS5 instead of embeddings for search" and id DEC-0042
- WHEN the engine commits the addition
- THEN the commit header is exactly `note(add): decision "FTS5 instead of embeddings for search" [DEC-0042]`

#### Scenario: Update commit records the meaningful change

- GIVEN a spec whose status changes from draft to active
- WHEN the engine commits the update
- THEN the commit header identifies the note and the status transition

#### Scenario: Derivation is deterministic

- GIVEN the same note frontmatter describing the same write event
- WHEN the commit message is derived twice
- THEN both derivations produce byte-identical messages

### Requirement: Human authorship with trailer provenance

The engine SHALL always set the Git author of note commits to the human (from `.memory/local.json` or inherited Git config), so `git blame` shows people. Agent/client provenance SHALL be recorded in commit trailers (for example `Via:` and `Spec:`), never in the author identity.

#### Scenario: Agent-driven save commits as the human

- GIVEN a note saved through an agent via the MCP server
- WHEN the engine commits it
- THEN the Git author is the human identity, and the commit message carries trailers naming the agent/client and the linked spec

### Requirement: Generated index regeneration in separate commits

The engine SHALL commit generated index regeneration separately from note writes, using headers of the form `chore(index): regenerate maps (<N> notes)`. A `chore(index)` commit MUST NOT be mixed with note commits.

#### Scenario: Index regeneration lands as its own commit

- GIVEN note commits created by a sync cycle
- WHEN generated index files are regenerated
- THEN regeneration is committed separately as `chore(index): regenerate maps (<N> notes)` with N matching the regenerated note count, distinct from every `note(...)` commit

### Requirement: Conflict resolution ladder

When a pull-rebase hits conflicts, the engine SHALL resolve by file category. Generated files (`index/`): take either side, finish the rebase, and regenerate deterministically — no human involvement. Append-only logs: Git's `merge=union` concatenates both sides and the engine sorts entries by timestamp and dedupes by entry id afterwards. Curated notes (specs, decisions) with a same-region conflict: abort the rebase leaving local state intact, snapshot the incoming side on a branch named `conflict/<date>-<note-id>`, write a conflict note into the vault itself, surface it via the `status` tool, and pause only pushing — vault reads and writes continue locally during resolution. Guided resolution via `supermemory resolve` SHALL present both sides, let the human merge, and finalize with commit and push.

#### Scenario: Generated-file conflicts regenerate without a human

- GIVEN a rebase conflict confined to generated files under `index/`
- WHEN the ladder processes it
- THEN the rebase completes, the files are regenerated deterministically, and no human action was required

#### Scenario: Log conflicts merge as a sorted, deduplicated union

- GIVEN two clones appending different entries to the same log note and a rebase conflict on it
- WHEN the ladder processes it
- THEN the resulting log contains both sides' entries, sorted by timestamp with duplicate entry ids removed, and no entry from either side is missing

#### Scenario: Curated conflict pauses push, never work

- GIVEN divergent edits to the same region of a spec on local and remote
- WHEN the rebase conflicts
- THEN the rebase is aborted with local state intact, a `conflict/<date>-<note-id>` snapshot branch holds the incoming side, a conflict note appears in the vault, `status` reports the unresolved conflict, and local reads/writes continue while push is paused

#### Scenario: Guided resolve completes the cycle

- GIVEN an unresolved curated conflict with its conflict note in the vault
- WHEN a human runs `supermemory resolve` and merges both sides
- THEN the resolution is committed and pushed, and `status` no longer reports the conflict

### Requirement: Never silently delete

Across every conflict policy and sync path, the engine SHALL NOT discard information without either merging it deterministically or archiving it visibly. After any conflicted sync, both the local and the remote side of every conflicting note SHALL be recoverable.

#### Scenario: Divergent curated edits lose nothing

- GIVEN divergent local and remote edits to the same curated note
- WHEN the conflict ladder runs to completion
- THEN the local version remains in the vault and the remote version is recoverable from the snapshot branch — no version of the note is silently destroyed

### Requirement: Secrets lint before every commit

The engine SHALL run secrets lint before every commit, on every trigger (debounce, interval, manual tool, CLI) and at every stage of the conflict ladder that creates a commit. A commit containing a flagged secret SHALL be blocked, and the secret SHALL NOT be pushed.

#### Scenario: Flagged secret blocks the commit

- GIVEN a pending write whose content contains a flagged secret
- WHEN any sync trigger attempts to commit it
- THEN the commit is blocked, the secret is not pushed, and the blockage is reported so the writer can remediate

#### Scenario: Clean content commits normally

- GIVEN pending writes containing no flagged secrets
- WHEN a sync trigger runs
- THEN the lint passes and the commits proceed

### Requirement: Single sync owner per clone

The engine SHALL enforce one sync owner per vault clone via a pidfile lock under `.memory/cache/`. When a second sync actor (for example, the CLI while the server owns sync) requests the lock, it SHALL delegate to the owner or report ownership — two sync engines MUST NEVER race on the same clone.

#### Scenario: Second actor never races the lock owner

- GIVEN the MCP server owns sync for a clone
- WHEN the CLI attempts to sync the same clone
- THEN the CLI either delegates to the owning server or reports that sync is owned, and no two engines mutate the clone's Git state concurrently

### Requirement: Sync safety and hygiene

The engine SHALL NOT force-push, ever. Network failures SHALL be retried with backoff without losing local writes, and `status` SHALL continue reporting the last successful sync.

#### Scenario: Network failure loses nothing and is reported

- GIVEN a sync attempt against an unreachable remote
- WHEN the push fails
- THEN local commits and pending writes remain intact, the engine retries with backoff, and `status` reports the last successful sync

#### Scenario: History is never rewritten by force

- GIVEN a remote whose history diverged from local
- WHEN the engine syncs
- THEN recovery goes through rebase or abort-and-snapshot paths, and no force-push is issued
