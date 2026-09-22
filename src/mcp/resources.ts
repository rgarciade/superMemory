import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  GitSettings,
  LifecycleSettings,
  NoteTypeDef,
  RulesModel,
} from "../rules/types.js";
import { templatePathFor } from "../util/paths.js";

/**
 * `rules://current` resource content (parsed rules + rendered templates,
 * design §5.2/RFC §5 "Resources"), and the agent-instructions template
 * embedded into server instructions when present (RFC §9).
 */

export const RULES_RESOURCE_URI = "rules://current";

export interface RulesResourceContent {
  formatVersion: string;
  noteTypes: Record<string, NoteTypeDef>;
  lifecycle: LifecycleSettings;
  conflictPolicyDefaults: Record<string, string>;
  git: GitSettings;
  /** Raw template content per declared note type, when a template file exists. */
  templates: Record<string, string>;
}

/** Reads each declared note type's template file; a missing template is omitted, not an error. */
export async function loadTemplates(
  vaultPath: string,
  rules: RulesModel,
): Promise<Record<string, string>> {
  const templates: Record<string, string> = {};
  for (const type of Object.keys(rules.noteTypes)) {
    try {
      templates[type] = await readFile(templatePathFor(vaultPath, type), "utf8");
    } catch {
      // No template for this type — fine, not every type needs one.
    }
  }
  return templates;
}

export function buildRulesResourceContent(
  rules: RulesModel,
  templates: Record<string, string>,
): RulesResourceContent {
  return {
    formatVersion: rules.formatVersion,
    noteTypes: rules.noteTypes,
    lifecycle: rules.lifecycle,
    conflictPolicyDefaults: rules.conflictPolicyDefaults,
    git: rules.git,
    templates,
  };
}

/** `.memory/templates/agent-instructions.md`, when present — embedded as server instructions. */
export async function readAgentInstructions(vaultPath: string): Promise<string | undefined> {
  const instructionsPath = path.join(vaultPath, ".memory", "templates", "agent-instructions.md");
  try {
    return await readFile(instructionsPath, "utf8");
  } catch {
    return undefined;
  }
}
