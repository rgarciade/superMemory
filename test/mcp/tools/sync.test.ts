import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createStore } from "../../../src/index/store.js";
import { buildCatalog } from "../../../src/mcp/catalog.js";
import { createSyncHandler } from "../../../src/mcp/tools/sync.js";
import { parseRules } from "../../../src/rules/parser.js";
import type { RulesModel } from "../../../src/rules/types.js";
import { FIXTURE_VAULT_DIR } from "../../helpers/create-test-vault.js";
import { createToolTestClient } from "../../helpers/create-tool-test-client.js";

// Task 2.15 [RED first]: sync ships as a documented stub coded against the
// future engine interface — no schema change when P3 wires the real
// engine (tool-catalog spec: "sync and status — engine visibility").

async function loadRules(): Promise<RulesModel> {
  const raw = await readFile(path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

describe("sync (in-memory transport)", () => {
  it("returns the resulting status, documenting that the engine is not yet wired", async () => {
    const store = createStore();
    const rules = await loadRules();
    const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
    const catalog = buildCatalog(rules);
    const def = catalog.tools.find((t) => t.name === "sync");
    if (!def) throw new Error("catalog must declare sync");

    const { client, close } = await createToolTestClient([
      {
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        handler: createSyncHandler({ store, rules, clock }) as never,
      },
    ]);
    try {
      const result = await client.callTool({ name: "sync", arguments: {} });
      const payload = result.structuredContent as { note: string; formatVersion: string };
      expect(payload.note).toMatch(/P3/);
      expect(payload.formatVersion).toBe(rules.formatVersion);
    } finally {
      await close();
    }
  });
});
