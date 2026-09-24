# Agent Instructions

Consult specs before changing code that a spec covers. Record durable
decisions as `decision` notes linked to their spec via `spec_id`. Log
sessions in the day's session log.

- Before implementing, `find` the relevant spec and read it with
  `read_with_context`.
- After a meaningful decision, `save` a decision note linked to the spec.
- Never edit `index/` by hand — it is regenerated.
- Secrets never enter the vault; the sync engine blocks flagged secrets.
