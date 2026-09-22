# Delta for Index

M1 scope: single-vault mode. The derived SQLite index under `.memory/cache/` (RFC §3 invariants 1–2): property tables, FTS5, and the wikilink/`spec_id` link graph — a disposable cache, rebuildable from vault contents alone.

## ADDED Requirements

### Requirement: Derived index lives in a gitignored cache

The system SHALL maintain its search index as a SQLite database under `<vault>/.memory/cache/`. The cache directory SHALL be gitignored: the index is derived data, and no index artifact SHALL ever be committed to the vault repository.

#### Scenario: Cache is present locally and invisible to Git

- GIVEN a validated vault on which the system has run
- WHEN the vault's Git status is inspected
- THEN `.memory/cache/` exists on disk holding the SQLite index, and Git reports no untracked or modified files under it

### Requirement: Index covers properties, full text, and the link graph

The index SHALL make queryable, for every note in the vault: its frontmatter properties (per declared note types), its full text via FTS5, and its position in the wikilink/`spec_id` link graph. Property filtering, free-text search, and backlink queries SHALL all be answerable from the index.

#### Scenario: All three index surfaces answer queries

- GIVEN a vault with notes carrying typed frontmatter, body text, wikilinks, and `spec_id` references
- WHEN property-filtered search, free-text search, and backlink queries run
- THEN each returns results consistent with the vault contents — matching properties for filters, matching text for full-text queries, and referencing notes for backlink queries

### Requirement: Full rebuildability from vault contents alone

The index SHALL be fully rebuildable from the vault's Markdown contents alone. Deleting `.memory/cache/` MUST lose nothing: no note, rule, template, or configuration data resides exclusively in the cache, and the system SHALL rebuild the index (on next start or on demand) with results identical to a never-deleted index.

#### Scenario: Deleting the cache loses nothing

- GIVEN a vault with an existing populated index and known `find`/`read_with_context` results
- WHEN the entire `.memory/cache/` directory is deleted and the system rebuilds the index
- THEN the same queries return the same results as before deletion, and no vault content is missing

### Requirement: Incremental update on write

When a note is created or updated through the system, the index SHALL reflect the change without a full rebuild or restart: the new or updated note is immediately visible to `find` and backlink queries.

#### Scenario: Saved note is immediately searchable

- GIVEN a running system with a populated index
- WHEN a new decision is saved
- THEN an immediate `find` by that decision's id returns it, and backlink queries on its `spec_id` include it — with no manual reindex step
