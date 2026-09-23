import { describe, expect, it } from "vitest";
import { createStore, putNote } from "../../../src/index/store.js";
import type { IndexedNote } from "../../../src/index/types.js";
import { buildCatalog } from "../../../src/mcp/catalog.js";
import { createFindHandler } from "../../../src/mcp/tools/find.js";
import { parseRules } from "../../../src/rules/parser.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RulesModel } from "../../../src/rules/types.js";
import { FIXTURE_VAULT_DIR } from "../../helpers/create-test-vault.js";
import { createToolTestClient } from "../../helpers/create-tool-test-client.js";

// Task 2.11 [RED first]: find — property + free-text search over the
// in-memory transport (tool-catalog spec: property filter + free-text
// scenarios).

function note(overrides: Partial<IndexedNote> = {}): IndexedNote {
  return {
    id: "SPEC-a",
    type: "spec",
    title: "Search spec",
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

describe("find (in-memory transport)", () => {
  it("returns only notes matching a property filter", async () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-active", path: "specs/active.md", status: "active" }));
    putNote(store, note({ id: "SPEC-draft", path: "specs/draft.md", status: "draft" }));

    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    const findDef = catalog.tools.find((t) => t.name === "find");
    if (!findDef) throw new Error("catalog must declare find");

    const { client, close } = await createToolTestClient([
      {
        name: findDef.name,
        description: findDef.description,
        inputSchema: findDef.inputSchema,
        handler: createFindHandler({ store }) as never,
      },
    ]);
    try {
      const result = await client.callTool({ name: "find", arguments: { status: "active" } });
      expect(result.structuredContent).toEqual({
        results: [{ id: "SPEC-active", title: "Search spec", status: "active", path: "specs/active.md", type: "spec" }],
      });
    } finally {
      await close();
    }
  });

  it("hits a free-text query over note bodies", async () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-a", path: "specs/a.md", body: "full-text search over the vault" }));
    putNote(store, note({ id: "SPEC-b", path: "specs/b.md", body: "unrelated" }));

    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    const findDef = catalog.tools.find((t) => t.name === "find");
    if (!findDef) throw new Error("catalog must declare find");

    const { client, close } = await createToolTestClient([
      {
        name: findDef.name,
        description: findDef.description,
        inputSchema: findDef.inputSchema,
        handler: createFindHandler({ store }) as never,
      },
    ]);
    try {
      const result = await client.callTool({ name: "find", arguments: { text: "full-text search" } });
      const payload = result.structuredContent as { results: Array<{ id: string }> };
      expect(payload.results.map((r) => r.id)).toEqual(["SPEC-a"]);
    } finally {
      await close();
    }
  });

  // Fresh-context review finding 9: `new Date("garbage")` is a truthy
  // Invalid Date, so an unparseable date filter was silently ignored
  // instead of raising an actionable error.
  it("rejects an unparseable date_from with an actionable error instead of silently ignoring it", async () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-a", path: "specs/a.md", frontmatter: { review_after: "2026-06-01" } }));

    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    const findDef = catalog.tools.find((t) => t.name === "find");
    if (!findDef) throw new Error("catalog must declare find");

    const { client, close } = await createToolTestClient([
      {
        name: findDef.name,
        description: findDef.description,
        inputSchema: findDef.inputSchema,
        handler: createFindHandler({ store }) as never,
      },
    ]);
    try {
      const result = await client.callTool({
        name: "find",
        arguments: { date_field: "review_after", date_from: "not-a-date" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it("declares no project argument on the wire schema", async () => {
    const rules = await loadRules();
    const catalog = buildCatalog(rules);
    const findDef = catalog.tools.find((t) => t.name === "find");
    if (!findDef) throw new Error("catalog must declare find");

    const { client, close } = await createToolTestClient([
      {
        name: findDef.name,
        description: findDef.description,
        inputSchema: findDef.inputSchema,
        handler: createFindHandler({ store: createStore() }) as never,
      },
    ]);
    try {
      const tools = await client.listTools();
      const schema = tools.tools.find((t) => t.name === "find")?.inputSchema;
      expect(schema?.properties && "project" in schema.properties).toBeFalsy();
    } finally {
      await close();
    }
  });
});
