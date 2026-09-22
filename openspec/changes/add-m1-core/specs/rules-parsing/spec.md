# Delta for Rules Parsing

M1 scope: single-vault mode. Parses `.memory/rules.md` format v1 (RFC §4.2–§4.4): the team ontology as Markdown with typed fenced YAML blocks, plus `{{placeholder}}` template rendering by string interpolation only.

## ADDED Requirements

### Requirement: rules.md v1 format parsing

The system SHALL parse `.memory/rules.md` version 1 into a structured rules model, extracting the frontmatter `format_version` and the four fenced YAML blocks (`note_types`, `lifecycle`, `conflict_policy_defaults`, `git`). Parsing MUST NOT require any block beyond those the format defines, and a malformed or missing required block SHALL produce a parse error that names the offending block and the line area where parsing failed.

#### Scenario: Valid rules file parses completely

- GIVEN a vault whose `.memory/rules.md` carries `format_version: 1.0` and well-formed fenced YAML blocks for note_types, lifecycle, conflict_policy_defaults, and git
- WHEN the system loads the rules
- THEN parsing succeeds and the resulting model exposes the declared note types (with folder, frontmatter fields, naming pattern, and conflict policy per type), lifecycle settings, conflict policy defaults, and git settings

#### Scenario: Malformed YAML block fails with a located error

- GIVEN a `rules.md` whose `note_types` fenced block contains invalid YAML
- WHEN the system loads the rules
- THEN loading fails with an error identifying the `note_types` block as the source of the failure, and no partial rules model is served as valid

### Requirement: Template rendering by string interpolation

The system SHALL render note templates from `.memory/templates/<type>.md` by replacing `{{placeholder}}` tokens with provided values using pure string interpolation. The renderer MUST NOT evaluate logic, conditionals, loops, or external lookups beyond the supplied values.

#### Scenario: Decision template renders with supplied values

- GIVEN the `decision` template containing `{{next_id}}`, `{{spec_id}}`, `{{today}}`, `{{author}}`, and `{{title}}` placeholders
- WHEN the system renders it with concrete values for those placeholders
- THEN the rendered output contains the supplied values everywhere the placeholders appeared, and no `{{placeholder}}` token for a supplied key remains

#### Scenario: Renderer performs interpolation only

- GIVEN a template whose body contains plain Markdown prose and `{{placeholder}}` tokens
- WHEN the system renders it
- THEN prose passes through unchanged, no conditional or loop syntax is interpreted, and rendering does not depend on any template engine beyond string substitution

### Requirement: Note validation against declared rules

The system SHALL validate a note against its declared type's rules: required frontmatter fields are present, field types match the declared types, enum values are within the declared set, pattern fields match their declared pattern, the file name matches the type's `naming` pattern, and the file resides in the type's declared folder. A failed validation SHALL identify the violated rule (field, constraint, naming, or folder) in its error.

#### Scenario: Missing required field is rejected with the violated rule

- GIVEN the rules declare a `spec` type requiring `spec_id`, `status`, and `owner`
- WHEN a note of type `spec` is validated without `owner`
- THEN validation fails with an error naming `owner` as the missing required field

#### Scenario: Pattern and placement violations are each identified

- GIVEN the rules declare `spec_id` with pattern `SPEC-[a-z0-9-]+`, naming `{spec_id}-{slug}.md`, and folder `specs/`
- WHEN a note is validated whose `spec_id` is `SPEC Bad!`, or whose file name or folder does not match the declared naming and folder
- THEN validation fails with an error identifying the specific violated rule (pattern mismatch, naming mismatch, or wrong folder)

#### Scenario: Conforming note passes validation

- GIVEN a note with all required fields, valid enum values, pattern-conforming values, a naming-conforming file name, and the declared folder
- WHEN the note is validated
- THEN validation succeeds

### Requirement: format_version contract surface

The system SHALL accept a vault whose `rules.md` `format_version` has the same major version as the format this build supports (minor and patch being backward compatible), and SHALL refuse a vault whose `format_version` requires a higher major version. Refusal MUST present an actionable error that names the required format version and directs the user to update the app. This check SHALL be enforced whenever rules are loaded, including at boot and after a sync brings in changed rules.

#### Scenario: Same-major version is accepted

- GIVEN a build supporting rules format 1.x and a vault declaring `format_version: 1.0`
- WHEN the rules are loaded
- THEN loading succeeds

#### Scenario: Higher major version is refused with an actionable error

- GIVEN a build supporting rules format 1.x and a vault declaring `format_version: 2.0`
- WHEN the rules are loaded
- THEN the operation fails with an error stating the vault requires format 2.x and instructing the user to update the app, and the vault is not served or synced against mismatched rules

#### Scenario: Format check re-runs when a sync changes rules

- GIVEN a running system whose vault passes the format check at boot
- WHEN a sync pulls a `rules.md` change that bumps `format_version` to an unsupported major version
- THEN the system refuses to operate against the new rules and reports the same actionable version error
