---
format_version: 1.0
---

# Team Memory Rules

Prose explanation the team can read and discuss. Everything the engine
needs is in the blocks below.

## Note types

```yaml
note_types:
  spec:
    folder: specs/
    frontmatter:            # required fields and types
      spec_id: { type: string, required: true, pattern: "SPEC-[a-z0-9-]+" }
      status: { type: enum, values: [draft, active, deprecated], required: true }
      owner: { type: string, required: true }
      review_after: { type: date, required: false }
    naming: "{spec_id}-{slug}.md"
    sections: [Purpose, Scope, Decisions, "## Linked Knowledge"]
    conflict_policy: human_required

  decision:
    folder: decisions/
    frontmatter:
      decision_id: { type: string, required: true, pattern: "DEC-[0-9]+" }
      spec_id: { type: string, required: true }     # the hub it belongs to
      status: { type: enum, values: [proposed, accepted, superseded] }
    naming: "{decision_id}-{slug}.md"
    conflict_policy: human_required

  incident:
    folder: incidents/
    frontmatter:
      incident_id: { type: string, required: true, pattern: "INC-[0-9]+" }
      spec_id: { type: string, required: false }
      status: { type: enum, values: [open, resolved] }
    conflict_policy: human_required

  session_log:              # append-only
    folder: logs/
    frontmatter:
      date: { type: date, required: true }
      actor: { type: string, required: true }
    conflict_policy: union
```

## Lifecycle

```yaml
lifecycle:
  staleness:
    field: review_after
    on_stale: flag          # surfaced by the `find` tool and status reports
  archive:
    folder: attic/
    policy: manual          # or `auto` per type
```

## Conflict policies

```yaml
conflict_policy_defaults:
  generated_indexes: regenerate
  session_logs: union
  decisions: human_required
  specs: human_required
  daily_notes: theirs_and_archive   # remote wins; local side archived in attic/
```

## Git

```yaml
git:
  mode: auto              # auto | manual | pr  (team policy; see §6.1)
  sync_interval_minutes: 15
  debounce_seconds: 45
  commit_language: en
  secrets_lint: true
  generated_paths: [index/, .memory/cache/]
```
