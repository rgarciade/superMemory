import { z } from "zod";
import type { FieldDef, NoteTypeDef, RulesModel } from "../rules/types.js";

/**
 * Pure `buildCatalog(rules)` (design §5.2, tool-catalog spec): exactly six
 * tools, no `project` parameter anywhere. `save`'s schema is generated per
 * note type — discriminated by type, `.strict()`, required/types/enums
 * from the model. Rules are the catalog's ONLY input; a rules reload
 * rebuilds the whole catalog in place with no code change (spec scenario:
 * "editing rules changes behavior without redeploy").
 *
 * Wire-schema note (SDK limitation, disclosed): the MCP SDK renders a
 * usable JSON Schema for `listTools()` only from a schema exposing a
 * `.shape` (a plain `ZodObject`) — a `z.discriminatedUnion` accepted by
 * `registerTool()` for runtime validation renders as an empty object in
 * `listTools()` (verified against @modelcontextprotocol/sdk 1.30.0: its
 * `normalizeObjectSchema` requires `.shape`, which `ZodDiscriminatedUnion`
 * does not have). So `save`'s *wire* `inputSchema` is a single flat,
 * permissive object (every note type's fields merged, non-type/content
 * fields typed `z.unknown().optional()`) — it renders correctly and still
 * rejects unknown field names via `.strict()`. The real per-type
 * constraints (required/enum/pattern) are enforced server-side by
 * `rules/validate.ts` via the save pipeline (already tested in 2.8), and
 * are exposed here, precisely, as `saveSchemas` — one true `ZodObject`
 * per declared type — for direct inspection/testing and for the `save`
 * tool description text.
 */

export const TOOL_NAMES = [
  "find",
  "read_with_context",
  "save",
  "changes_since",
  "sync",
  "status",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny> | z.ZodTypeAny;
}

export interface ToolCatalog {
  tools: ToolDefinition[];
  /** One true `.strict()` schema per declared note type (design §5.2). */
  saveSchemas: Record<string, z.ZodObject<z.ZodRawShape>>;
}

export const FIND_INPUT_SHAPE = {
  type: z.string().optional(),
  status: z.string().optional(),
  spec_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  owner: z.string().optional(),
  date_field: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  text: z.string().optional(),
  limit: z.number().int().positive().optional(),
};

export const READ_WITH_CONTEXT_INPUT_SHAPE = {
  id: z.string(),
};

export const CHANGES_SINCE_INPUT_SHAPE = {
  since: z.string(),
};

const EMPTY_INPUT_SHAPE = {};

export function buildCatalog(rules: RulesModel): ToolCatalog {
  const saveSchemas = buildSaveSchemas(rules);
  const tools: ToolDefinition[] = [
    { name: "find", description: describeFind(rules), inputSchema: FIND_INPUT_SHAPE },
    {
      name: "read_with_context",
      description: describeReadWithContext(),
      inputSchema: READ_WITH_CONTEXT_INPUT_SHAPE,
    },
    { name: "save", description: describeSave(rules), inputSchema: buildSaveWireSchema(rules) },
    {
      name: "changes_since",
      description: describeChangesSince(),
      inputSchema: CHANGES_SINCE_INPUT_SHAPE,
    },
    { name: "sync", description: describeSync(), inputSchema: EMPTY_INPUT_SHAPE },
    { name: "status", description: describeStatus(rules), inputSchema: EMPTY_INPUT_SHAPE },
  ];
  return { tools, saveSchemas };
}

// ---- save schema generation ----------------------------------------------

function fieldToZod(def: FieldDef): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (def.type) {
    case "string":
      base = def.pattern
        ? z.string().regex(new RegExp(def.pattern), `must match the pattern ${def.pattern}`)
        : z.string();
      break;
    case "enum": {
      const values = def.values ?? [];
      base = values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string();
      break;
    }
    case "date":
      // Date-shaped string on the wire (design §5.2); server-side
      // rules/validate.ts also accepts a parsed Date instance.
      base = z.string();
      break;
    case "number":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
  }
  return def.required ? base : base.optional();
}

function noteTypeSchema(typeName: string, def: NoteTypeDef): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {
    type: z.literal(typeName),
    content: z.string(),
    title: z.string().optional(),
  };
  for (const [field, fieldDef] of Object.entries(def.frontmatter)) {
    shape[field] = fieldToZod(fieldDef);
  }
  return z.object(shape).strict();
}

function buildSaveSchemas(rules: RulesModel): Record<string, z.ZodObject<z.ZodRawShape>> {
  const schemas: Record<string, z.ZodObject<z.ZodRawShape>> = {};
  for (const [type, def] of Object.entries(rules.noteTypes)) {
    schemas[type] = noteTypeSchema(type, def);
  }
  return schemas;
}

/** See the wire-schema note in the module doc comment above. */
function buildSaveWireSchema(rules: RulesModel): z.ZodTypeAny {
  const typeNames = Object.keys(rules.noteTypes);
  const shape: z.ZodRawShape = {
    type: typeNames.length > 0 ? z.enum(typeNames as [string, ...string[]]) : z.string(),
    content: z.string(),
    title: z.string().optional(),
  };
  for (const def of Object.values(rules.noteTypes)) {
    for (const field of Object.keys(def.frontmatter)) {
      if (!(field in shape)) shape[field] = z.unknown().optional();
    }
  }
  return z.object(shape).strict();
}

// ---- descriptions (derived from the model — reload-safe) ------------------

function describeFind(rules: RulesModel): string {
  const types = Object.keys(rules.noteTypes).join(", ") || "none declared";
  return (
    "Search the vault by property filters (type, status, spec_id, tags, owner, date range) " +
    `and/or free text. Declared note types: ${types}. Results are filtered and ` +
    "deterministically ordered — not relevance-ranked."
  );
}

function describeReadWithContext(): string {
  return (
    "Read a note's content and frontmatter plus its knowledge neighborhood: backlinks " +
    "(wikilinks and spec_id references), referenced specs' status, and the most " +
    "recently linked decisions/incidents."
  );
}

function describeSave(rules: RulesModel): string {
  const perType = Object.entries(rules.noteTypes).map(([name, def]) => {
    const required = Object.entries(def.frontmatter)
      .filter(([, field]) => field.required)
      .map(([field]) => field);
    const namingPart = def.naming ? `, naming: ${def.naming}` : "";
    const requiredPart = required.length > 0 ? `, required: ${required.join(", ")}` : "";
    return `${name} (folder: ${def.folder}${namingPart}${requiredPart})`;
  });
  return (
    "Create or update a note of a declared type. A non-conforming save is rejected " +
    `with the violated rule. Declared types: ${perType.join("; ")}.`
  );
}

function describeChangesSince(): string {
  return (
    "Report what changed in the vault since a given ISO timestamp, at note " +
    "granularity, classified as added, updated, status_changed, or removed."
  );
}

function describeSync(): string {
  // P3 wiring (task 3.13): the tool drives the REAL engine now, so the
  // description describes the real behavior honestly — no stub language.
  // The cycle is the same ONE code path the CLI and the scheduler use:
  // serialized behind the vault's sync lock, never force-pushing.
  return (
    "Trigger an immediate sync cycle (pull, commit pending writes, push) and return the " +
    "resulting sync status. The cycle is serialized behind the vault's sync lock and " +
    "never force-pushes; safe to call at any time."
  );
}

function describeStatus(rules: RulesModel): string {
  const staleness = rules.lifecycle.staleness?.field;
  const stalenessPart = staleness ? ` (staleness field: ${staleness})` : "";
  return (
    "Report sync state: last successful sync, pending local writes, unresolved " +
    `conflicts, stale notes${stalenessPart}, and the vault format version.`
  );
}
