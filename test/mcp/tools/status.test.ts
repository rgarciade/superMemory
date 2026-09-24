import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createStore, putNote } from "../../../src/index/store.js";
import type { IndexedNote } from "../../../src/index/types.js";
import { buildCatalog } from "../../../src/mcp/catalog.js";
import { createStatusHandler } from "../../../src/mcp/tools/status.js";
import { parseRules } from "../../../src/rules/parser.js";
import type { RulesModel } from "../../../src/rules/types.js";
import { FIXTURE_VAULT_DIR } from "../../helpers/create-test-vault.js";
import { createToolTestClient } from "../../helpers/create-tool-test-client.js";

// Task 2.15 [RED first]: status ships as a documented stub coded against
// the future engine interface (tool-catalog spec: "status reflects vault
// state" — the stale-notes part is genuinely computable in P2 from the
// index + rules.lifecycle.staleness + Clock, with no engine needed).

function note(overrides: Partial<IndexedNote> = {}): IndexedNote {
  return {
    id: "SPEC-a",
    type: "spec",
    title: "Spec A",
    path: "specs/a.md",
    tags: [],
    frontmatter: {},
    body: "",
    wikilinks: [],
    ...overrides,
  };
}

async function loadRules(): Promise<RulesModel> {
  const raw = await readFile(path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

describe("status (in-memory transport)", () => {
  it("reports stale notes past their lifecycle staleness field, plus the vault format version", async () => {
    const store = createStore();
    putNote(
      store,
      note({
        id: "SPEC-stale",
        path: "specs/stale.md",
        frontmatter: { review_after: "2020-01-01" },
      }),
    );
    putNote(
      store,
      note({
        id: "SPEC-fresh",
        path: "specs/fresh.md",
        frontmatter: { review_after: "2099-01-01" },
      }),
    );

    const rules = await loadRules();
    const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
    const catalog = buildCatalog(rules);
    const def = catalog.tools.find((t) => t.name === "status");
    if (!def) throw new Error("catalog must declare status");

    const { client, close } = await createToolTestClient([
      {
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        handler: createStatusHandler({ store, rules, clock }) as never,
      },
    ]);
    try {
      const result = await client.callTool({ name: "status", arguments: {} });
      const payload = result.structuredContent as {
        staleNotes: Array<{ id: string }>;
        formatVersion: string;
        pendingWrites: number;
      };
      expect(payload.staleNotes.map((n) => n.id)).toEqual(["SPEC-stale"]);
      expect(payload.formatVersion).toBe(rules.formatVersion);
      expect(payload.pendingWrites).toBe(0); // stub: engine-owned state lands in P3
    } finally {
      await close();
    }
  });

  it("reports no stale notes when the rules declare no staleness field", async () => {
    const store = createStore();
    putNote(store, note({ frontmatter: { review_after: "2020-01-01" } }));

    const rules = await loadRules();
    const rulesNoStaleness: RulesModel = { ...rules, lifecycle: {} };
    const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
    const handler = createStatusHandler({ store, rules: rulesNoStaleness, clock });
    const result = await handler();
    const payload = result.structuredContent as { staleNotes: unknown[] };
    expect(payload.staleNotes).toEqual([]);
  });
});
