import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { AppError } from "../util/errors.js";
import { checkFormatVersion, normalizeFormatVersion } from "./version.js";
import type {
  FieldDef,
  FieldType,
  GitSettings,
  NoteTypeDef,
  RulesModel,
} from "./types.js";

/**
 * rules.md v1 parser (RFC §4.2): Markdown with typed fenced YAML blocks —
 * prose for humans, YAML for the engine. Frontmatter carries
 * `format_version`; the four blocks are `note_types`, `lifecycle`,
 * `conflict_policy_defaults`, `git`. A malformed or missing required
 * block fails with `RULES_PARSE_ERROR` naming the block and the line
 * area; no partial model is ever served as valid. The format_version
 * contract (version.ts) is enforced on every load.
 */

const REQUIRED_BLOCKS = [
  "note_types",
  "lifecycle",
  "conflict_policy_defaults",
  "git",
] as const;

type BlockName = (typeof REQUIRED_BLOCKS)[number];

interface FencedBlock {
  /** Sniffed top-level key (block identity), e.g. "note_types". */
  name: string;
  /** 1-based line of the opening fence in the source file. */
  startLine: number;
  yaml: string;
}

export function parseRules(content: string): RulesModel {
  const { data: frontmatter } = matter(content);
  const declared = frontmatter["format_version"];
  checkFormatVersion(
    typeof declared === "string" || typeof declared === "number"
      ? declared
      : undefined,
  );

  const blocks = extractFencedYamlBlocks(content);
  const byName = new Map<string, FencedBlock>();
  for (const block of blocks) {
    if (!byName.has(block.name)) {
      byName.set(block.name, block);
    }
  }

  for (const required of REQUIRED_BLOCKS) {
    if (!byName.has(required)) {
      throw new AppError(
        "RULES_PARSE_ERROR",
        `rules.md is missing the required \`${required}\` fenced yaml block.`,
        {
          hint: `Add a \`\`\`yaml fenced block starting with \`${required}:\` (see RFC §4.2), or re-run vault init for a fresh rules.md.`,
        },
      );
    }
  }

  const rawNoteTypes = parseBlock(byName, "note_types");
  if (Object.keys(rawNoteTypes).length === 0) {
    throw new AppError(
      "RULES_PARSE_ERROR",
      "rules.md `note_types` block declares no note types.",
      { hint: "Declare at least one note type with a folder (RFC §4.2)." },
    );
  }

  const noteTypes: Record<string, NoteTypeDef> = {};
  for (const [typeName, rawDef] of Object.entries(rawNoteTypes)) {
    if (typeof rawDef !== "object" || rawDef === null) {
      throw new AppError(
        "RULES_PARSE_ERROR",
        `rules.md note type \`${typeName}\` must be a mapping.`,
        { hint: "Give the type a folder and frontmatter declarations." },
      );
    }
    noteTypes[typeName] = parseNoteTypeDef(
      typeName,
      rawDef as Record<string, unknown>,
    );
  }

  const lifecycle = parseBlock(byName, "lifecycle");
  const conflictPolicyDefaults = parseBlock(
    byName,
    "conflict_policy_defaults",
  ) as Record<string, string>;
  const rawGit = parseBlock(byName, "git");

  return {
    formatVersion:
      typeof declared === "string" || typeof declared === "number"
        ? normalizeFormatVersion(declared)
        : "",
    noteTypes,
    lifecycle: parseLifecycle(lifecycle),
    conflictPolicyDefaults,
    git: parseGit(rawGit),
  };
}

export async function loadRules(rulesPath: string): Promise<RulesModel> {
  let content: string;
  try {
    content = await readFile(rulesPath, "utf8");
  } catch {
    throw new AppError(
      "RULES_PARSE_ERROR",
      `rules.md not found at ${rulesPath}.`,
      {
        hint: "Run `supermemory init` inside the vault to create .memory/rules.md.",
      },
    );
  }
  return parseRules(content);
}

// ---- block extraction -------------------------------------------------

function extractFencedYamlBlocks(content: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "```yaml") {
      const startLine = i + 1; // fence line, 1-based
      const body: string[] = [];
      i += 1;
      while (i < lines.length && (lines[i] ?? "").trim() !== "```") {
        body.push(lines[i] ?? "");
        i += 1;
      }
      const yaml = body.join("\n");
      blocks.push({ name: sniffBlockName(yaml), startLine, yaml });
    }
    i += 1;
  }
  return blocks;
}

function sniffBlockName(yaml: string): string {
  for (const raw of yaml.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(line);
    if (match?.[1]) return match[1];
    return "unknown";
  }
  return "unknown";
}

function parseBlock(
  byName: Map<string, FencedBlock>,
  name: BlockName,
): Record<string, unknown> {
  const block = byName.get(name);
  if (!block) {
    throw new AppError(
      "RULES_PARSE_ERROR",
      `rules.md is missing the required \`${name}\` block.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(block.yaml);
  } catch (err) {
    throw new AppError(
      "RULES_PARSE_ERROR",
      `rules.md \`${name}\` block has invalid YAML around line ${block.startLine}: ${yamlErrorDetail(err)}`,
      {
        hint: `Fix the YAML inside the \`${name}\` fenced block (starts at line ${block.startLine} of rules.md).`,
      },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError(
      "RULES_PARSE_ERROR",
      `rules.md \`${name}\` block must be a YAML mapping (around line ${block.startLine}).`,
    );
  }
  const mapping = parsed as Record<string, unknown>;
  // The block's first top-level key is its identity (e.g. `note_types:`);
  // unwrap it so callers receive the block's body directly.
  const inner = mapping[name];
  if (inner === undefined) {
    throw new AppError(
      "RULES_PARSE_ERROR",
      `rules.md \`${name}\` block must start with \`${name}:\` (around line ${block.startLine}).`,
    );
  }
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
    throw new AppError(
      "RULES_PARSE_ERROR",
      `rules.md \`${name}\` block body must be a YAML mapping (around line ${block.startLine}).`,
    );
  }
  return inner as Record<string, unknown>;
}

function yamlErrorDetail(err: unknown): string {
  if (err instanceof Error) {
    const pos = (err as { linePos?: number[][] }).linePos;
    const line = pos?.[0]?.[0];
    const at = line !== undefined ? ` (block line ${line})` : "";
    return `${err.message.split("\n")[0] ?? "invalid YAML"}${at}`;
  }
  return "invalid YAML";
}

// ---- section mappers ----------------------------------------------------

const FIELD_TYPES: readonly FieldType[] = [
  "string",
  "enum",
  "date",
  "number",
  "boolean",
];

function parseNoteTypeDef(
  typeName: string,
  raw: Record<string, unknown>,
): NoteTypeDef {
  const folder = raw["folder"];
  if (typeof folder !== "string" || folder === "") {
    throw new AppError(
      "RULES_PARSE_ERROR",
      `rules.md note type \`${typeName}\` is missing its folder declaration.`,
      { hint: `Add \`folder:\` to the \`${typeName}\` entry in the note_types block.` },
    );
  }
  const rawFrontmatter = raw["frontmatter"];
  const frontmatter: Record<string, FieldDef> = {};
  if (rawFrontmatter !== undefined) {
    if (typeof rawFrontmatter !== "object" || rawFrontmatter === null) {
      throw new AppError(
        "RULES_PARSE_ERROR",
        `rules.md note type \`${typeName}\` has an invalid frontmatter mapping.`,
      );
    }
    for (const [field, rawDef] of Object.entries(
      rawFrontmatter as Record<string, unknown>,
    )) {
      frontmatter[field] = parseFieldDef(typeName, field, rawDef);
    }
  }
  const naming = raw["naming"];
  const conflictPolicy = raw["conflict_policy"];
  const idField = raw["id_field"];
  const sections = raw["sections"];
  return {
    folder,
    frontmatter,
    ...(typeof naming === "string" ? { naming } : {}),
    ...(typeof conflictPolicy === "string" ? { conflictPolicy } : {}),
    ...(typeof idField === "string" ? { idField } : {}),
    ...(Array.isArray(sections)
      ? { sections: sections.map((s) => String(s)) }
      : {}),
  };
}

function parseFieldDef(
  typeName: string,
  field: string,
  raw: unknown,
): FieldDef {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError(
      "RULES_PARSE_ERROR",
      `rules.md field \`${typeName}.${field}\` must declare a mapping with type/required.`,
    );
  }
  const def = raw as Record<string, unknown>;
  const type = def["type"];
  const required = def["required"];
  if (typeof type !== "string" || !FIELD_TYPES.includes(type as FieldType)) {
    throw new AppError(
      "RULES_PARSE_ERROR",
      `rules.md field \`${typeName}.${field}\` has an invalid type \`${String(type)}\` (expected one of ${FIELD_TYPES.join(", ")}).`,
    );
  }
  const pattern = def["pattern"];
  const values = def["values"];
  return {
    type: type as FieldType,
    required: required === true,
    ...(typeof pattern === "string" ? { pattern } : {}),
    ...(Array.isArray(values)
      ? { values: values.map((v) => String(v)) }
      : {}),
  };
}

function parseLifecycle(raw: Record<string, unknown>): RulesModel["lifecycle"] {  const staleness = raw["staleness"];
  const archive = raw["archive"];
  return {
    ...(typeof staleness === "object" && staleness !== null
      ? {
          staleness: {
            field: String(
              (staleness as Record<string, unknown>)["field"] ?? "",
            ),
            onStale: String(
              (staleness as Record<string, unknown>)["on_stale"] ?? "",
            ),
          },
        }
      : {}),
    ...(typeof archive === "object" && archive !== null
      ? {
          archive: {
            folder: String((archive as Record<string, unknown>)["folder"] ?? ""),
            policy: String((archive as Record<string, unknown>)["policy"] ?? ""),
          },
        }
      : {}),
  };
}

function parseGit(raw: Record<string, unknown>): GitSettings {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : undefined;
  return {
    ...(typeof raw["mode"] === "string" ? { mode: raw["mode"] } : {}),
    ...{
      syncIntervalMinutes: num(raw["sync_interval_minutes"]),
      debounceSeconds: num(raw["debounce_seconds"]),
    },
    ...(typeof raw["commit_language"] === "string"
      ? { commitLanguage: raw["commit_language"] }
      : {}),
    ...(typeof raw["secrets_lint"] === "boolean"
      ? { secretsLint: raw["secrets_lint"] }
      : {}),
    ...(Array.isArray(raw["generated_paths"])
      ? { generatedPaths: raw["generated_paths"].map((p) => String(p)) }
      : {}),
  };
}
