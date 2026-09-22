import { describe, expect, it } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  buildRulesResourceContent,
  loadTemplates,
  readAgentInstructions,
  RULES_RESOURCE_URI,
} from "../../src/mcp/resources.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import { createTestVault } from "../helpers/create-test-vault.js";

// Task 2.10 [RED first]: `rules://current` resource content (parsed rules +
// rendered templates) and the agent-instructions template used for server
// instructions (design §5.2, RFC §9).

async function loadRules(vaultRoot: string): Promise<RulesModel> {
  const raw = await readFile(path.join(vaultRoot, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

describe("RULES_RESOURCE_URI", () => {
  it("is the exact rules://current URI", () => {
    expect(RULES_RESOURCE_URI).toBe("rules://current");
  });
});

describe("loadTemplates", () => {
  it("reads each declared note type's template when present", async () => {
    const vault = await createTestVault();
    try {
      const rules = await loadRules(vault.root);
      const templates = await loadTemplates(vault.root, rules);
      expect(templates["spec"]).toContain("{{title}}");
      expect(templates["decision"]).toContain("{{next_id}}");
    } finally {
      await vault.cleanup();
    }
  });

  it("omits a type with no template file rather than failing", async () => {
    const vault = await createTestVault();
    try {
      const rules = await loadRules(vault.root);
      const rulesWithGhostType: RulesModel = {
        ...rules,
        noteTypes: {
          ...rules.noteTypes,
          ghost: { folder: "ghosts/", frontmatter: {} },
        },
      };
      const templates = await loadTemplates(vault.root, rulesWithGhostType);
      expect(templates["ghost"]).toBeUndefined();
      expect(templates["spec"]).toBeDefined();
    } finally {
      await vault.cleanup();
    }
  });
});

describe("buildRulesResourceContent", () => {
  it("carries the parsed rules model and the rendered templates together", async () => {
    const vault = await createTestVault();
    try {
      const rules = await loadRules(vault.root);
      const templates = await loadTemplates(vault.root, rules);
      const content = buildRulesResourceContent(rules, templates);
      expect(content.formatVersion).toBe(rules.formatVersion);
      expect(content.noteTypes["spec"]).toEqual(rules.noteTypes["spec"]);
      expect(content.templates["spec"]).toContain("{{title}}");
    } finally {
      await vault.cleanup();
    }
  });
});

describe("readAgentInstructions", () => {
  it("returns the agent-instructions.md content when present", async () => {
    const vault = await createTestVault();
    try {
      const instructions = await readAgentInstructions(vault.root);
      expect(instructions).toContain("Agent Instructions");
      expect(instructions).toContain("read_with_context");
    } finally {
      await vault.cleanup();
    }
  });

  it("returns undefined when the file is absent", async () => {
    const vault = await createTestVault();
    try {
      const instructionsPath = path.join(vault.root, ".memory", "templates", "agent-instructions.md");
      await rm(instructionsPath);
      const instructions = await readAgentInstructions(vault.root);
      expect(instructions).toBeUndefined();
    } finally {
      await vault.cleanup();
    }
  });
});
