# Tool Catalog Specification

## Purpose

The six MCP tools generated from `rules.md` (RFC §5): `find`, `read_with_context`, `save`, `changes_since`, `sync`, `status`. All mutations go through typed, validated operations. (Landed by change `add-m1-core`; M1 scope: single-vault mode, `serve --vault`.)

## Requirements

### Requirement: Single-vault tool catalog

The MCP server in single-vault mode SHALL expose exactly six tools: `find`, `read_with_context`, `save`, `changes_since`, `sync`, and `status`. In this mode no tool SHALL take a `project` argument. No free-form `write_file` or `delete_file` tool SHALL exist; every mutation goes through `save`.

#### Scenario: Server boots with the six M1 tools and no project parameter

- GIVEN a valid vault and the server started in single-vault mode
- WHEN the tool catalog is listed
- THEN exactly `find`, `read_with_context`, `save`, `changes_since`, `sync`, and `status` are exposed, and none of their input schemas declare a `project` parameter

### Requirement: Tool schemas and descriptions generated from rules

The `save` input schema for each declared note type SHALL be generated from that type's `rules.md` definition (required fields, types, enum values), and tool descriptions SHALL embed the team's own prose rules from `rules.md`. Changing `rules.md` SHALL change generated schemas and descriptions without any code change or redeploy.

#### Scenario: Save schema reflects the declared note type

- GIVEN the rules declare a `decision` type requiring `decision_id` and `status`
- WHEN the `save` tool schema for type `decision` is inspected
- THEN it requires `decision_id` and `status` with the declared types and enum values

#### Scenario: Editing rules changes behavior without redeploy

- GIVEN a running system
- WHEN a new required field is added to a note type in `rules.md` and the rules are reloaded
- THEN subsequently generated `save` schemas enforce the new field with no code change

### Requirement: find — structured and full-text search

The `find` tool SHALL search the vault over the property index with filters by note type, `status`, `spec_id`, `tags`, `owner`, and date ranges, plus free-text search over the full-text index. Results SHALL include each note's id, title, status, and path.

#### Scenario: Property filter returns only matching notes

- GIVEN a vault with notes of several statuses
- WHEN `find` is called with a `status` filter matching only active notes
- THEN results contain exactly the notes whose frontmatter status matches, each with id, title, status, and path

#### Scenario: Free-text query hits note content

- GIVEN a vault containing a note whose body mentions "full-text search"
- WHEN `find` is called with a free-text query for that term
- THEN the note is among the results

### Requirement: read_with_context — the knowledge neighborhood

The `read_with_context` tool SHALL return the note content plus its frontmatter, a summary of backlinks (both wikilinks and `spec_id` references), the status/lifecycle information of referenced specs, and the most recent linked decisions/incidents for that note, so that reading a spec surfaces its linked knowledge.

#### Scenario: Reading a spec surfaces its linked knowledge

- GIVEN a spec referenced by two decisions and one incident via `spec_id` and wikilinks
- WHEN `read_with_context` is called on the spec
- THEN the response includes the spec content and frontmatter, backlinks naming those three notes, the referenced specs' status, and the recent linked decisions/incidents

### Requirement: save — validated create and update

The `save` tool SHALL create or update a note of a declared type only when the note conforms to `rules.md` (required fields, patterns, naming, folder). A non-conforming save SHALL be rejected with an error identifying the violated rule. When a note is saved with a `spec_id` set, the system SHALL maintain the target spec's Linked Knowledge section: entries are appended when linked notes are created, and repeated saves of the same note MUST NOT create duplicate entries.

#### Scenario: Non-conforming save is rejected with the violated rule

- GIVEN the rules require `decision_id` to match `DEC-[0-9]+`
- WHEN `save` is called with a `decision` whose `decision_id` violates the pattern
- THEN the save is rejected and the error names the violated field and pattern

#### Scenario: Valid save maintains Linked Knowledge without duplicates

- GIVEN a spec `SPEC-search-002` with a Linked Knowledge section
- WHEN a decision linked to that spec is saved, and the same decision is saved again afterwards
- THEN the spec's Linked Knowledge section lists the decision exactly once

### Requirement: changes_since — note-granularity continuity

The `changes_since` tool SHALL report what changed in the vault since a given timestamp, as a diff summary at note granularity classifying each change as added, updated, or status changed.

#### Scenario: Changes since a timestamp are classified per note

- GIVEN a timestamp before two note creations, one content update, and one status change
- WHEN `changes_since` is called with that timestamp
- THEN the result lists each affected note exactly once with the correct classification (added, updated, or status changed) and no unrelated notes

### Requirement: sync and status — engine visibility

The `sync` tool SHALL trigger a sync cycle immediately (pull, commit pending writes, push) and return the sync status. The `status` tool SHALL report the last successful sync, the count of pending local writes, unresolved conflicts, notes flagged stale by lifecycle rules, and the vault's format version.

#### Scenario: Status reflects vault state

- GIVEN a vault with one unsaved-pending write, one unresolved conflict, and one note past its `review_after` date
- WHEN `status` is called
- THEN the response reports those pending writes, the unresolved conflict, the stale note, the last successful sync, and the vault format version

#### Scenario: Sync tool completes a full cycle

- GIVEN pending local writes in the vault
- WHEN the `sync` tool is invoked
- THEN the full pull-commit-push cycle runs and the tool returns the resulting sync status
