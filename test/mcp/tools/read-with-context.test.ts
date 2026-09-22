import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createStore, putNote } from "../../../src/index/store.js";
import type { IndexedNote } from "../../../src/index/types.js";
import { buildCatalog } from "../../../src/mcp/catalog.js";
import { createReadWithContextHandler } from "../../../src/mcp/tools/read-with-context.js";
import { parseRules } from "../../../src/rules/parser.js";
import type { RulesModel } from "../../../src/rules/types.js";
import { FIXTURE_VAULT_DIR } from "../../helpers/create-test-vault.js";
import { createToolTestClient } from "../../helpers/create-tool-test-client.js";

// Task 2.12 [RED first]: read_with_context — content + frontmatter +
// backlinks (wikilinks and spec_id) + referenced specs' status + 5 most
// recent linked decisions/incidents (tool-catalog spec: spec-neighborhood
// scenario).

function note(overrides: Partial<IndexedNote> = {}): IndexedNote {
  return {
    id: "SPEC-search",
    type: "spec",
    title: "Search spec",
    path: "specs/a.md",
    status: "active",
    tags: [],
    frontmatter: { spec_id: "SPEC-search", status: "active" },
    body: "prose",
    wikilinks: [],
    ...overrides,
  };
}

async function loadRules(): Promise<RulesModel> {
  const raw = await readFile(path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

async function client(store: ReturnType<typeof createStore>) {
  const rules = await loadRules();
  const catalog = buildCatalog(rules);
  const def = catalog.tools.find((t) => t.name === "read_with_context");
  if (!def) throw new Error("catalog must declare read_with_context");
  return createToolTestClient([
    {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      handler: createReadWithContextHandler({ store }) as never,
    },
  ]);
}

describe("read_with_context (in-memory transport)", () => {
  it("surfaces a spec's content, frontmatter, backlinks, and recent linked decisions/incidents", async () => {
    const store = createStore();
    putNote(store, note());
    putNote(
      store,
      note({
        id: "DEC-1",
        type: "decision",
        path: "decisions/DEC-1.md",
        title: "Use an in-memory index",
        specId: "SPEC-search",
        frontmatter: { decision_id: "DEC-1", spec_id: "SPEC-search", date: "2026-01-01" },
      }),
    );
    putNote(
      store,
      note({
        id: "DEC-2",
        type: "decision",
        path: "decisions/DEC-2.md",
        title: "Keep queries.ts as the only read surface",
        specId: "SPEC-search",
        frontmatter: { decision_id: "DEC-2", spec_id: "SPEC-search", date: "2026-02-01" },
      }),
    );
    putNote(
      store,
      note({
        id: "INC-1",
        type: "incident",
        path: "incidents/INC-1.md",
        title: "Search returned stale results",
        wikilinks: ["SPEC-search"],
        frontmatter: { incident_id: "INC-1", date: "2026-03-01" },
      }),
    );

    const { client: c, close } = await client(store);
    try {
      const result = await c.callTool({ name: "read_with_context", arguments: { id: "SPEC-search" } });
      const payload = result.structuredContent as {
        id: string;
        content: string;
        frontmatter: Record<string, unknown>;
        backlinks: Array<{ id: string }>;
        recentLinked: Array<{ id: string }>;
      };
      expect(payload.id).toBe("SPEC-search");
      expect(payload.content).toBe("prose");
      expect(payload.frontmatter["status"]).toBe("active");
      expect(payload.backlinks.map((b) => b.id).sort()).toEqual(["DEC-1", "DEC-2", "INC-1"]);
      // Most recent first: INC-1 (2026-03-01) > DEC-2 (2026-02-01) > DEC-1 (2026-01-01)
      expect(payload.recentLinked.map((n) => n.id)).toEqual(["INC-1", "DEC-2", "DEC-1"]);
    } finally {
      await close();
    }
  });

  it("surfaces a referenced spec's status when reading a note that links to it", async () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-search" }));
    putNote(
      store,
      note({
        id: "DEC-1",
        type: "decision",
        path: "decisions/DEC-1.md",
        title: "Use an in-memory index",
        specId: "SPEC-search",
        frontmatter: { decision_id: "DEC-1", spec_id: "SPEC-search" },
      }),
    );

    const { client: c, close } = await client(store);
    try {
      const result = await c.callTool({ name: "read_with_context", arguments: { id: "DEC-1" } });
      const payload = result.structuredContent as {
        referencedSpecs: Array<{ id: string; status?: string }>;
      };
      expect(payload.referencedSpecs).toEqual([{ id: "SPEC-search", status: "active" }]);
    } finally {
      await close();
    }
  });

  it("returns an error result for an unknown id", async () => {
    const store = createStore();
    const { client: c, close } = await client(store);
    try {
      const result = await c.callTool({ name: "read_with_context", arguments: { id: "NOPE" } });
      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });
});
