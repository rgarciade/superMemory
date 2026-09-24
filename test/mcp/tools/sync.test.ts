import { describe, expect, it } from "vitest";
import { buildCatalog } from "../../../src/mcp/catalog.js";
import { createSyncHandler } from "../../../src/mcp/tools/sync.js";
import { parseRules } from "../../../src/rules/parser.js";
import type { RulesModel } from "../../../src/rules/types.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_VAULT_DIR } from "../../helpers/create-test-vault.js";
import { fakeEngine } from "../../helpers/fake-engine.js";
import { createToolTestClient } from "../../helpers/create-tool-test-client.js";

// Task 3.13 [RED first]: the `sync` tool switches from the P2 stub to
// the REAL engine — runCycle('tool'), then the resulting engine status
// (tool-catalog spec: "Sync tool completes a full cycle"; design §5.3).
// No wire schema change: same six-tool catalog, same status fields; the
// stub-only `note` disclosure field is gone because there is no stub.

async function loadRules(): Promise<RulesModel> {
  const raw = await readFile(path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

describe("sync (in-memory transport, engine-backed)", () => {
  it("runs the engine cycle with the 'tool' trigger and returns the post-cycle status", async () => {
    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    const def = catalog.tools.find((t) => t.name === "sync");
    if (!def) throw new Error("catalog must declare sync");

    const engine = fakeEngine({
      report: { outcome: "synced", pushed: true },
      state: { lastSuccessfulSyncAt: "2026-01-01T00:00:00.000Z", pendingWrites: 0 },
    });
    const { client, close } = await createToolTestClient([
      {
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        handler: createSyncHandler({ engine }) as never,
      },
    ]);
    try {
      const result = await client.callTool({ name: "sync", arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(engine.cycles).toEqual(["tool"]);
      const payload = result.structuredContent as {
        lastSuccessfulSyncAt: string | null;
        formatVersion: string;
        note?: string;
      };
      expect(payload.lastSuccessfulSyncAt).toBe("2026-01-01T00:00:00.000Z");
      expect(payload.formatVersion).toBe(rules.formatVersion);
      // The stub disclosure field is gone — there is no stub to disclose.
      expect(payload.note).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("surfaces a thrown cycle as an error result naming the cause", async () => {
    const rules = await loadRules();
    const engine = fakeEngine({ failCycleWith: new Error("git blew up") });
    const handler = createSyncHandler({ engine });
    const result = await handler();
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    const text = result.content[0] as { type: "text"; text: string };
    expect(text.text).toContain("git blew up");
  });
});
