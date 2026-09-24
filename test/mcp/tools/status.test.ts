import { describe, expect, it } from "vitest";
import { buildCatalog } from "../../../src/mcp/catalog.js";
import { createStatusHandler } from "../../../src/mcp/tools/status.js";
import { parseRules } from "../../../src/rules/parser.js";
import type { RulesModel } from "../../../src/rules/types.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_VAULT_DIR } from "../../helpers/create-test-vault.js";
import { fakeEngine } from "../../helpers/fake-engine.js";
import { createToolTestClient } from "../../helpers/create-tool-test-client.js";

// Task 3.13 [RED first → GREEN]: `status` switches from the P2 stub to
// the REAL engine — the handler returns the engine's state snapshot
// verbatim (tool-catalog spec: "Status reflects vault state"). The real
// staleness computation is proven in test/sync/state.test.ts (3.7);
// these tests pin the SEAM: the tool surfaces exactly what the engine
// reports, including the engine-owned fields the stub used to zero out.

async function loadRules(): Promise<RulesModel> {
  const raw = await readFile(path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

describe("status (in-memory transport, engine-backed)", () => {
  it("returns the engine's state verbatim, including the engine-owned fields", async () => {
    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    const def = catalog.tools.find((t) => t.name === "status");
    if (!def) throw new Error("catalog must declare status");

    const engine = fakeEngine({
      state: {
        lastSuccessfulSyncAt: "2026-01-01T00:00:00.000Z",
        pendingWrites: 3,
        conflicts: [
          {
            noteId: "SPEC-9",
            notePath: "specs/SPEC-9.md",
            snapshotBranch: "conflict/20250601-1200-SPEC-9",
            conflictNotePath: "/vault/conflicts/20250601-1200-SPEC-9.md",
            detectedAt: "2025-06-01T12:00:00.000Z",
          },
        ],
        staleNotes: [{ id: "SPEC-stale", title: "Stale", path: "specs/stale.md", type: "spec" }],
        formatVersion: rules.formatVersion,
        pushPaused: true,
        lockOwner: "server",
      },
    });

    const { client, close } = await createToolTestClient([
      {
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        handler: createStatusHandler({ engine }) as never,
      },
    ]);
    try {
      const result = await client.callTool({ name: "status", arguments: {} });
      expect(result.isError).toBeFalsy();
      const payload = result.structuredContent as {
        lastSuccessfulSyncAt: string | null;
        pendingWrites: number;
        conflicts: unknown[];
        staleNotes: Array<{ id: string }>;
        formatVersion: string;
        pushPaused: boolean;
        lockOwner: string | null;
        note?: string;
      };
      expect(payload.lastSuccessfulSyncAt).toBe("2026-01-01T00:00:00.000Z");
      expect(payload.pendingWrites).toBe(3);
      expect(payload.conflicts).toHaveLength(1);
      expect(payload.staleNotes.map((n) => n.id)).toEqual(["SPEC-stale"]);
      expect(payload.formatVersion).toBe(rules.formatVersion);
      expect(payload.pushPaused).toBe(true);
      expect(payload.lockOwner).toBe("server");
      // The stub disclosure field is gone — there is no stub to disclose.
      expect(payload.note).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("reflects an idle engine as a zeroed state with no stub note", async () => {
    const rules = await loadRules();
    const engine = fakeEngine({ state: { formatVersion: rules.formatVersion } });
    const handler = createStatusHandler({ engine });
    const result = await handler();
    const payload = result.structuredContent as {
      pendingWrites: number;
      conflicts: unknown[];
      staleNotes: unknown[];
      note?: string;
    };
    expect(payload.pendingWrites).toBe(0);
    expect(payload.conflicts).toEqual([]);
    expect(payload.staleNotes).toEqual([]);
    expect(payload.note).toBeUndefined();
  });
});
