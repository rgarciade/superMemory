/**
 * RulesModel — the shared vocabulary every module speaks (design §7).
 * Produced by the rules.md v1 parser; consumed by validation, the MCP
 * catalog (P2), the sync engine, and config precedence resolution.
 */

export type FieldType = "string" | "enum" | "date" | "number" | "boolean";

export interface FieldDef {
  type: FieldType;
  required: boolean;
  /** RegExp source for `string` fields (e.g. "SPEC-[a-z0-9-]+"). */
  pattern?: string;
  /** Allowed values for `enum` fields. */
  values?: string[];
}

export interface NoteTypeDef {
  folder: string;
  frontmatter: Record<string, FieldDef>;
  /** File-name template, e.g. "{spec_id}-{slug}.md". */
  naming?: string;
  /** Required sections (documented for templates/agents). */
  sections?: string[];
  /** human_required | union | ... (defaults resolved via conflict_policy_defaults). */
  conflictPolicy?: string;
  /** Explicit id field for this type; convention fallback is `<type>_id`. */
  idField?: string;
}

export interface LifecycleStaleness {
  field: string;
  onStale: string;
}

export interface LifecycleSettings {
  staleness?: LifecycleStaleness;
  archive?: { folder: string; policy: string };
}

export interface GitSettings {
  mode?: string;
  syncIntervalMinutes?: number;
  debounceSeconds?: number;
  commitLanguage?: string;
  secretsLint?: boolean;
  generatedPaths?: string[];
}

export interface RulesModel {
  /** Raw declared version from frontmatter (checked via version.ts). */
  formatVersion: string;
  noteTypes: Record<string, NoteTypeDef>;
  lifecycle: LifecycleSettings;
  conflictPolicyDefaults: Record<string, string>;
  git: GitSettings;
}
