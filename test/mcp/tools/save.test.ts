import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildIndex } from "../../../src/index/build.js";
import { buildCatalog } from "../../../src/mcp/catalog.js";
import { createSaveHandler } from "../../../src/mcp/tools/save.js";
import { createNullSyncPort } from "../../../src/notes/save-pipeline.js";
import { parseRules } from "../../../src/rules/parser.js";
import type { RulesModel } from "../../../src/rules/types.js";
import { createTestVault, type TestVault } from "../../helpers/create-test-vault.js";
import { createToolTestClient } from "../../helpers/create-tool-test-client.js";

// Task 2.13 [RED first]: save — thin: zod schema check -> validateNote
// (violation returned verbatim) -> save-pipeline. Contract tests:
// non-conforming save names the violated rule; valid save maintains
// Linked Knowledge without duplicates.

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const fixedClock = { now: () => FIXED_NOW };

const SPEC_NOTE = `---
spec_id: SPEC-search
status: draft
owner: Raul
---

# Search spec

## Linked Knowledge

`;

async function loadRules(vaultRoot: string): Promise<RulesModel> {
  const raw = await readFile(path.join(vaultRoot, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

async function setup(): Promise<{
  vault: TestVault;
  rules: RulesModel;
  store: Awaited<ReturnType<typeof buildIndex>>;
  client: Awaited<ReturnType<typeof createToolTestClient>>["client"];
  close: () => Promise<void>;
}> {
  const vault = await createTestVault({
    seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
  });
  const rules = await loadRules(vault.root);
  const store = await buildIndex(vault.root, rules);
  const catalog = buildCatalog(rules);
  const saveDef = catalog.tools.find((t) => t.name === "save");
  if (!saveDef) throw new Error("catalog must declare save");

  const { client, close } = await createToolTestClient([
    {
      name: saveDef.name,
      description: saveDef.description,
      inputSchema: saveDef.inputSchema,
      handler: createSaveHandler({
        vaultPath: vault.root,
        rules,
        store,
        clock: fixedClock,
        syncPort: createNullSyncPort(),
        via: "test",
      }) as never,
    },
  ]);

  return { vault, rules, store, client, close };
}

describe("save (in-memory transport)", () => {
  it("rejects a non-conforming save, naming the violated rule, and writes nothing", async () => {
    const { vault, client, close } = await setup();
    try {
      const result = await client.callTool({
        name: "save",
        arguments: {
          type: "decision",
          decision_id: "not-a-valid-id",
          spec_id: "SPEC-search",
          content: "# Bad decision\n",
        },
      });
      expect(result.isError).toBe(true);
      const payload = result.structuredContent as { issues?: Array<{ field?: string }> };
      expect(payload.issues?.some((i) => i.field === "decision_id")).toBe(true);

      const entries = await readFile(path.join(vault.root, "specs/SPEC-search-spec.md"), "utf8");
      expect(entries).not.toContain("Bad decision");
    } finally {
      await close();
      await vault.cleanup();
    }
  });

  it("creates a conforming note and returns its path and id", async () => {
    const { vault, client, close } = await setup();
    try {
      const result = await client.callTool({
        name: "save",
        arguments: {
          type: "decision",
          decision_id: "DEC-1",
          spec_id: "SPEC-search",
          status: "proposed",
          content: "# Use an in-memory index\n\nRationale.\n",
        },
      });
      expect(result.isError).toBeFalsy();
      const payload = result.structuredContent as { path: string; id: string };
      expect(payload.id).toBe("DEC-1");
      expect(payload.path).toMatch(/^decisions\/DEC-1-.*\.md$/);

      const onDisk = await readFile(path.join(vault.root, payload.path), "utf8");
      expect(onDisk).toContain("Use an in-memory index");
    } finally {
      await close();
      await vault.cleanup();
    }
  });

  it("refuses to overwrite a DIFFERENT note when two saves resolve to the same path (no naming template — fresh-context review finding 1)", async () => {
    const { vault, client, close } = await setup();
    try {
      const first = await client.callTool({
        name: "save",
        arguments: { type: "incident", incident_id: "INC-1", content: "# Login outage\n" },
      });
      expect(first.isError).toBeFalsy();
      const firstPayload = first.structuredContent as { path: string };

      const second = await client.callTool({
        name: "save",
        arguments: { type: "incident", incident_id: "INC-2", content: "# Login outage\n" },
      });
      expect(second.isError).toBe(true);
      const secondPayload = second.structuredContent as { error?: string };
      expect(secondPayload.error).toContain(firstPayload.path);

      // INC-1 must survive untouched on disk — not overwritten by INC-2's save.
      const onDisk = await readFile(path.join(vault.root, firstPayload.path), "utf8");
      expect(onDisk).toContain("incident_id: INC-1");
    } finally {
      await close();
      await vault.cleanup();
    }
  });

  it("still allows re-saving the SAME note whose path collides with itself (an intentional update)", async () => {
    const { vault, client, close } = await setup();
    try {
      const args = {
        type: "incident" as const,
        incident_id: "INC-1",
        status: "open",
        content: "# Login outage\n",
      };
      const first = await client.callTool({ name: "save", arguments: args });
      const second = await client.callTool({
        name: "save",
        arguments: { ...args, status: "resolved" },
      });
      expect(first.isError).toBeFalsy();
      expect(second.isError).toBeFalsy();

      const firstPayload = first.structuredContent as { path: string };
      const onDisk = await readFile(path.join(vault.root, firstPayload.path), "utf8");
      expect(onDisk).toContain("status: resolved");
    } finally {
      await close();
      await vault.cleanup();
    }
  });

  it("refuses a session_log save that would land on an existing path (no id to disambiguate — a Phase 3 sync/append question, not solved here)", async () => {
    const { vault, client, close } = await setup();
    try {
      const first = await client.callTool({
        name: "save",
        arguments: { type: "session_log", date: "2026-01-01", actor: "agent", content: "# Session log\n" },
      });
      expect(first.isError).toBeFalsy();

      const second = await client.callTool({
        name: "save",
        arguments: { type: "session_log", date: "2026-01-02", actor: "agent", content: "# Session log\n" },
      });
      expect(second.isError).toBe(true);
    } finally {
      await close();
      await vault.cleanup();
    }
  });

  it("maintains the target spec's Linked Knowledge section without duplicating on a repeated save", async () => {
    const { vault, client, close } = await setup();
    try {
      const args = {
        type: "decision" as const,
        decision_id: "DEC-1",
        spec_id: "SPEC-search",
        status: "proposed",
        content: "# Use an in-memory index\n",
      };
      const first = await client.callTool({ name: "save", arguments: args });
      const second = await client.callTool({ name: "save", arguments: args });
      expect(first.isError).toBeFalsy();
      expect(second.isError).toBeFalsy();

      const specOnDisk = await readFile(path.join(vault.root, "specs/SPEC-search-spec.md"), "utf8");
      const firstPayload = first.structuredContent as { path: string };
      const occurrences = specOnDisk.split(firstPayload.path).length - 1;
      expect(occurrences).toBe(1);
    } finally {
      await close();
      await vault.cleanup();
    }
  });
});
