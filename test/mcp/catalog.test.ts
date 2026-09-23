import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildCatalog, TOOL_NAMES } from "../../src/mcp/catalog.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import { FIXTURE_VAULT_DIR } from "../helpers/create-test-vault.js";

// Task 2.9 [RED first]: buildCatalog(rules) — exactly six tools, no `project`
// parameter anywhere, save schema per note type, descriptions derived from
// the model, rebuild-on-reload ready (tool-catalog spec).

async function loadRules(): Promise<RulesModel> {
  const raw = await readFile(path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

function shapeFieldNames(inputSchema: Record<string, z.ZodTypeAny> | z.ZodTypeAny): string[] {
  if (inputSchema instanceof z.ZodType) {
    // Not expected in this catalog (all non-save tools use raw shapes), but
    // handle a ZodObject defensively.
    const shape = (inputSchema as unknown as { shape?: Record<string, unknown> }).shape;
    return shape ? Object.keys(shape) : [];
  }
  return Object.keys(inputSchema);
}

describe("buildCatalog", () => {
  it("exposes exactly the six M1 tools, no more, no fewer", async () => {
    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    expect(catalog.tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(catalog.tools).toHaveLength(6);
  });

  it("declares no `project` parameter on any tool's input schema", async () => {
    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    for (const tool of catalog.tools) {
      expect(shapeFieldNames(tool.inputSchema)).not.toContain("project");
    }
    for (const schema of Object.values(catalog.saveSchemas)) {
      expect(Object.keys(schema.shape)).not.toContain("project");
    }
  });

  it("generates a per-type save schema requiring the declared fields with their types/enums", async () => {
    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    const decisionSchema = catalog.saveSchemas["decision"];
    expect(decisionSchema).toBeDefined();

    const ok = decisionSchema?.safeParse({
      type: "decision",
      decision_id: "DEC-1",
      spec_id: "SPEC-search",
      status: "proposed",
      content: "body",
    });
    expect(ok?.success).toBe(true);

    const badPattern = decisionSchema?.safeParse({
      type: "decision",
      decision_id: "not-valid",
      spec_id: "SPEC-search",
      content: "body",
    });
    expect(badPattern?.success).toBe(false);

    const missingRequired = decisionSchema?.safeParse({
      type: "decision",
      spec_id: "SPEC-search",
      content: "body",
    });
    expect(missingRequired?.success).toBe(false);

    const badEnum = decisionSchema?.safeParse({
      type: "decision",
      decision_id: "DEC-1",
      spec_id: "SPEC-search",
      status: "not-a-real-status",
      content: "body",
    });
    expect(badEnum?.success).toBe(false);
  });

  it("rejects undeclared fields on a per-type save schema (.strict())", async () => {
    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    const specSchema = catalog.saveSchemas["spec"];
    const result = specSchema?.safeParse({
      type: "spec",
      spec_id: "SPEC-x",
      status: "draft",
      owner: "raul",
      content: "body",
      bogus_field: "nope",
    });
    expect(result?.success).toBe(false);
  });

  it("changing the rules model changes the generated save schema without any code change (reload scenario)", async () => {
    const rules = await loadRules();
    const before = buildCatalog(rules).saveSchemas["decision"];
    const beforeResult = before?.safeParse({
      type: "decision",
      decision_id: "DEC-1",
      spec_id: "SPEC-search",
      content: "body",
    });
    expect(beforeResult?.success).toBe(true);

    const reloaded: RulesModel = {
      ...rules,
      noteTypes: {
        ...rules.noteTypes,
        decision: {
          ...rules.noteTypes["decision"]!,
          frontmatter: {
            ...rules.noteTypes["decision"]!.frontmatter,
            reviewer: { type: "string", required: true },
          },
        },
      },
    };
    const after = buildCatalog(reloaded).saveSchemas["decision"];
    const afterResult = after?.safeParse({
      type: "decision",
      decision_id: "DEC-1",
      spec_id: "SPEC-search",
      content: "body",
    });
    expect(afterResult?.success).toBe(false); // now missing the new required `reviewer` field
  });

  it("save tool descriptions embed the declared type's folder/naming/required fields from the model", async () => {
    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    const save = catalog.tools.find((t) => t.name === "save");
    expect(save?.description).toContain("decisions/");
    expect(save?.description).toContain("decision_id");
  });

  // Fresh-context review finding 6: describeSync promised "pull, commit
  // pending writes, push" with no hint that P2 ships it as a no-op stub —
  // the disclaimer only lived in the response `note` field, never in the
  // description an agent reads before calling the tool.
  it("sync tool description discloses it is a P2 stub, not an active engine trigger", async () => {
    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    const sync = catalog.tools.find((t) => t.name === "sync");
    expect(sync?.description).toMatch(/P3/);
  });

  it("catalog snapshot: tool names and descriptions are stable for a given rules model", async () => {
    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    expect(catalog.tools.map((t) => ({ name: t.name, description: t.description }))).toMatchSnapshot();
  });
});
