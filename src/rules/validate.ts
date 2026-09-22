import type { FieldDef, RulesModel } from "./types.js";

/**
 * Note validation against the declared rules (rules-parsing spec, design
 * §3 ownership boundary: this is the single validator — the MCP save
 * tool, the index, and sync all call it, none re-implement it).
 *
 * Pure: takes the rules model and a note, returns every violated rule
 * (field, constraint, naming, folder). An empty result means the note
 * conforms.
 */

export interface ValidationIssue {
  kind: "field" | "pattern" | "enum" | "naming" | "folder";
  field?: string;
  expected?: string;
  actual?: string;
  message: string;
}

export interface NoteForValidation {
  /** Declared note type, e.g. "spec". */
  type: string;
  frontmatter: Record<string, unknown>;
  /** File base name, e.g. "SPEC-search-search-spec.md". */
  fileName: string;
  /** Folder the note resides in, relative to the vault root, e.g. "specs/". */
  folder: string;
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function validateNote(
  rules: RulesModel,
  note: NoteForValidation,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const def = rules.noteTypes[note.type];
  if (!def) {
    issues.push({
      kind: "field",
      field: "type",
      expected: `one of: ${Object.keys(rules.noteTypes).join(", ")}`,
      actual: note.type,
      message: `unknown note type "${note.type}" — declared types are: ${Object.keys(rules.noteTypes).join(", ")}`,
    });
    return issues;
  }

  for (const [field, fieldDef] of Object.entries(def.frontmatter)) {
    const value = note.frontmatter[field];
    if (value === undefined || value === null) {
      if (fieldDef.required) {
        issues.push({
          kind: "field",
          field,
          expected: "present (required field)",
          message: `field "${field}" is required for type "${note.type}" but is missing`,
        });
      }
      continue;
    }
    const typeIssue = checkFieldType(note.type, field, fieldDef, value);
    if (typeIssue) issues.push(typeIssue);
  }

  if (def.naming) {
    const namingIssue = checkNaming(def.naming, note);
    if (namingIssue) issues.push(namingIssue);
  }

  if (note.folder !== def.folder) {
    issues.push({
      kind: "folder",
      field: "folder",
      expected: def.folder,
      actual: note.folder,
      message: `notes of type "${note.type}" must live in ${def.folder}, but this note is in ${note.folder}`,
    });
  }

  return issues;
}

function checkFieldType(
  typeName: string,
  field: string,
  def: FieldDef,
  value: unknown,
): ValidationIssue | undefined {
  switch (def.type) {
    case "string": {
      if (typeof value !== "string") {
        return typeMismatch(typeName, field, "string", value);
      }
      if (def.pattern && !new RegExp(`^(?:${def.pattern})$`).test(value)) {
        return {
          kind: "pattern",
          field,
          expected: def.pattern,
          actual: value,
          message: `field "${field}" value "${value}" violates the pattern ${def.pattern} (type "${typeName}")`,
        };
      }
      return undefined;
    }
    case "enum": {
      if (typeof value !== "string") {
        return typeMismatch(typeName, field, `enum(${(def.values ?? []).join(" | ")})`, value);
      }
      if (!(def.values ?? []).includes(value)) {
        return {
          kind: "enum",
          field,
          expected: (def.values ?? []).join(" | "),
          actual: value,
          message: `field "${field}" value "${value}" is not one of the allowed values: ${(def.values ?? []).join(", ")}`,
        };
      }
      return undefined;
    }
    case "date": {
      if (typeof value !== "string" || !DATE_SHAPE.test(value)) {
        return {
          kind: "field",
          field,
          expected: "date (YYYY-MM-DD)",
          actual: String(value),
          message: `field "${field}" must be a date in YYYY-MM-DD form, got "${String(value)}"`,
        };
      }
      return undefined;
    }
    case "number": {
      return typeof value === "number"
        ? undefined
        : typeMismatch(typeName, field, "number", value);
    }
    case "boolean": {
      return typeof value === "boolean"
        ? undefined
        : typeMismatch(typeName, field, "boolean", value);
    }
  }
}

function checkNaming(
  naming: string,
  note: NoteForValidation,
): ValidationIssue | undefined {
  // Naming templates like "{spec_id}-{slug}.md": declared fields must
  // match their frontmatter values; {slug} is a title-derived kebab slug
  // and matches any kebab run at validation time.
  let pattern = "";
  let rest = naming;
  let match: RegExpExecArray | null;
  const token = /\{([A-Za-z0-9_]+)\}/;
  while ((match = token.exec(rest)) !== null) {
    const key = match[1] ?? "";
    pattern += escapeRegExp(rest.slice(0, match.index));
    const value = note.frontmatter[key];
    pattern +=
      key === "slug"
        ? "[a-z0-9]+(?:-[a-z0-9]+)*"
        : value !== undefined && typeof value === "string"
          ? escapeRegExp(value)
          : "[^/]+";
    rest = rest.slice(match.index + match[0].length);
  }
  pattern += escapeRegExp(rest);
  if (!new RegExp(`^${pattern}$`).test(note.fileName)) {
    return {
      kind: "naming",
      field: "fileName",
      expected: naming,
      actual: note.fileName,
      message: `file name "${note.fileName}" does not match the naming pattern ${naming}`,
    };
  }
  return undefined;
}

function typeMismatch(
  typeName: string,
  field: string,
  expected: string,
  value: unknown,
): ValidationIssue {
  return {
    kind: "field",
    field,
    expected,
    actual: typeof value,
    message: `field "${field}" of type "${typeName}" must be ${expected}, got ${typeof value} (${String(value)})`,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
