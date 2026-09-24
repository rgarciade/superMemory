# Index Specification

## Purpose

An **in-memory** index built by parsing the vault (RFC §3 invariants 1–2): frontmatter properties, note text, and the wikilink/`spec_id` link graph — process-local derived state, never written to disk, reconstructed from the vault on every start. Expected M1 scale is well under 1,000 notes per vault (design OD-5), which is what makes a parse-on-boot index the right size of machinery. (Landed by change `add-m1-core`; M1 scope: single-vault mode.)

## Requirements

### Requirement: The index is in-memory and built from the vault at boot

The system SHALL build its index in memory at startup by walking the vault and parsing each Markdown note's frontmatter and body. The system SHALL NOT persist any index artifact to disk: no database file, no serialized snapshot, no on-disk cache of index state. The index therefore has no lifecycle of its own — it exists only for the lifetime of the process that built it.

#### Scenario: Starting the system writes no index artifact

- GIVEN a validated vault
- WHEN the system starts and its index is populated
- THEN queries answer from the in-memory index, no index file has been created anywhere in the vault, and Git reports no untracked or modified files

### Requirement: Index covers properties, full text, and the link graph

The index SHALL make queryable, for every note in the vault: its frontmatter properties (per declared note types), its full text, and its position in the wikilink/`spec_id` link graph. Property filtering, free-text search, and backlink queries SHALL all be answerable from the index.

#### Scenario: All three index surfaces answer queries

- GIVEN a vault with notes carrying typed frontmatter, body text, wikilinks, and `spec_id` references
- WHEN property-filtered search, free-text search, and backlink queries run
- THEN each returns results consistent with the vault contents — matching properties for filters, matching text for free-text queries, and referencing notes for backlink queries

### Requirement: No durable state outside the vault

The index SHALL hold no data that does not derive from the vault's Markdown contents: no note, rule, template, or configuration data resides exclusively in the index. Because the index is never persisted, every start reconstructs it from the vault alone, and discarding it MUST lose nothing.

#### Scenario: Restarting reproduces identical results

- GIVEN a vault with a populated in-memory index and known `find`/`read_with_context` results
- WHEN the process is stopped and started again against the same vault
- THEN the same queries return the same results as before the restart, and no vault content is missing

### Requirement: Incremental update without a full rebuild

When a note changes, the index SHALL reflect the change without a full rebuild or a restart. A note created or updated through the system SHALL become immediately visible to `find` and backlink queries. When notes change on disk outside the system — for example when a sync pulls remote commits, which names the changed files — the system SHALL re-parse only those files rather than re-walking the whole vault.

#### Scenario: Saved note is immediately searchable

- GIVEN a running system with a populated index
- WHEN a new decision is saved
- THEN an immediate `find` by that decision's id returns it, and backlink queries on its `spec_id` include it — with no manual reindex step

#### Scenario: Pulled changes re-parse only the changed notes

- GIVEN a running system with a populated index
- WHEN a sync applies remote commits that add one note and modify another
- THEN queries reflect both changes, only the named changed files are re-parsed, and unchanged notes are not re-read
