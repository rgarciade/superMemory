# Proposal: opt-in library version notes

Issue: [rgarciade/superMemory#6](https://github.com/rgarciade/superMemory/issues/6)
Status: proposed

## Summary

Store important, up-to-date facts about library versions (current API, breaking
changes, gotchas) as a **new declared note type** (`library_note`) that lives in
the vault alongside specs/decisions/incidents. The design deliberately reuses
the existing machinery end to end:

- **No new MCP tool.** The tool-catalog spec freezes the server at exactly six
  tools, and `save` schemas are already generated from `rules.md` ("changing
  `rules.md` SHALL change generated schemas and descriptions without any code
  change"). A new note type is a pure rules/data change.
- **No server-side fetching.** RFC §2 is explicit: *"the server never
  summarizes, embeds, or interprets."* The calling **agent** fetches from
  official sources with its own tools; the vault only stores stamped,
  validated facts.
- **No new staleness code.** Every vault already declares
  `lifecycle.staleness.field: review_after`; `status` flags stale notes by
  comparing that field to the clock. A library note that carries `review_after`
  is flagged for free.

## 1. What data is worth storing

Every note is anchored by a required **provenance triple** — facts without a
stamp are rejected by validation, so the vault never holds unstamped claims:

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `library_id` | `LIB-[a-z0-9-]+` | yes | stable identity, one note per library |
| `version` | string | yes | the version the facts describe (e.g. `19.2.0`) |
| `source_url` | string | yes | where the facts were verified (docs/changelog/releases) |
| `checked_at` | date | yes | when the facts were last verified against the source |
| `review_after` | date | yes | staleness horizon (recommended: `checked_at` + 90d) |
| `spec_id` | `SPEC-…` | no | links the note into a spec's linked-knowledge graph |
| `tags` | string[] | no | filterable via `find` (e.g. `npm`, `breaking-change`) |

The **body** holds the distilled knowledge, not a mirror of upstream docs:
`## Current API`, `## Breaking changes`, `## Gotchas`, `## Verification notes`.
Full changelogs and tutorial content stay upstream; `source_url` points back.

## 2. Note type and location

- Type: `library_note`, folder `libraries/`, naming `{library_id}-{slug}.md`,
  id field `library_id`. Example: `libraries/LIB-react.md`.
- **One mutable note per library** (id-keyed patch updates through the existing
  save pipeline, including update-only pull-before-write and path-conflict
  detection). Check history is git history; append-only per-check notes were
  rejected because they bloat the vault and rely on deferred union semantics.
- `rules.md` delta (per-vault data change, zero code):

```yaml
note_types:
  library_note:
    description: Opt-in, timestamped facts about a library version (current API, breaking changes, gotchas). Saved only on explicit user request.
    folder: libraries/
    id_field: library_id
    naming: "{library_id}-{slug}.md"
    frontmatter:
      library_id: { type: string, required: true, pattern: "LIB-[a-z0-9-]+" }
      version:     { type: string, required: true }
      source_url:  { type: string, required: true }
      checked_at:  { type: date,   required: true }
      review_after:{ type: date,   required: true }
      spec_id:     { type: string, required: false, pattern: "SPEC-[a-z0-9-]+" }
      tags:        { type: string, required: false }
```

This automatically yields: a strict per-type `save` schema, save-time
validation, index membership, an `index/library_note.md` map, and `find`
filters (`type`, `tags`, `spec_id`, date ranges over any date field).

## 3. Fetching, verification, staleness

- **Fetch/verify:** the agent, from official sources (vendor docs, changelogs,
  release pages), then one `save` call. The server stays deterministic and
  offline. Verification *is* the provenance triple: `version` + `source_url` +
  `checked_at`.
- **Staleness:** `review_after` rides the existing global
  `lifecycle.staleness` machinery — `status` lists stale library notes with no
  code change. Today `find` composes the same signal as
  `date_field: review_after, date_to: <today>`; a first-class `stale` filter on
  `find` is a small optional follow-up (the `find` gap predates this design —
  `rules.md` already claims staleness is "surfaced by the `find` tool").
- **Refresh flow:** user asks the agent to re-check a library → agent fetches →
  `save` with the same `library_id` patches `version`, `checked_at`,
  `review_after`, and the body.

## 4. Explicit user-triggered flow (opt-in)

- **v1 (no code):** the flow is the existing MCP `save` tool with
  `type: library_note`. "Only when the user explicitly asks" is an
  agent-behavior rule, stated in `.memory/templates/agent-instructions.md` and
  in the type description above. Honest limitation: the server cannot verify
  user intent; the required provenance triple keeps every note auditable
  (what version, from where, checked when) even if an agent over-saves.
- **Follow-up (small code, optional):** a CLI subcommand
  `supermemory library <name>` that opens `$EDITOR` on the pre-filled template
  (mirroring the `resolve` editor flow), stamps `checked_at`/`review_after`,
  and derives `library_id`. Human-invoked on a terminal ⇒ explicit intent by
  construction.

## 5. Constraints and known gaps

- `supermemory init`'s `RULES_MD` scaffold and the test fixture are pinned
  byte-identical by tests; adding the type must update both together, plus the
  RFC §4.1 layout.
- A mid-session `rules.md` change (e.g. pulled by sync) updates index, `find`,
  and state, but the running server's save schema/descriptions bind boot-time
  rules until restart. Known limitation; separate follow-up if it hurts.
- The template file must be named exactly `library_note.md`
  (`.memory/templates/<type>.md`). A latent `session-log.md` vs
  `session_log.md` mismatch already hides the session_log template today —
  worth fixing in the same pass.
- The RFC §4.1 layout gains a `libraries/` folder; the pre-listed `facts/`
  folder stays free for future generic fact types.

## 6. Follow-up implementation issues

1. Declare `library_note` in the rules scaffold: `RULES_MD`, init templates,
   fixture, RFC layout, `library_note.md` template.
2. Opt-in rule in `agent-instructions` template (explicit user request only).
3. Optional: CLI `supermemory library <name>` editor flow.
4. Optional: `find` `stale` filter (closes the pre-existing gap).
5. Latent bug fix: `session-log.md` → `session_log.md` template filename.
