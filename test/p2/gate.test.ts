import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildIndex } from "../../src/index/build.js";
import { createServer } from "../../src/mcp/server.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import { createTestVault, type TestVault } from "../helpers/create-test-vault.js";

/**
 * P2 phase gate (task 2.18): a contract suite over
 * InMemoryTransport.createLinkedPair() exercising the FULL composed
 * server (src/mcp/server.ts's createServer), not individual tools in
 * isolation — the cross-cutting properties the phase promises:
 *
 *   - exactly six tools listed, none with a `project` argument
 *   - save schema reflects declared required fields (end to end, via the
 *     real server, not just catalog.ts in isolation)
 *   - a rules reload changes schemas/behavior with no code change
 *   - restart identity: a fresh buildIndex over the same vault reproduces
 *     identical query results, and no index artifact is ever written
 *     anywhere in the vault
 *   - incremental visibility: a save is immediately findable through the
 *     same running server, no restart
 *
 * `npm test`, `npm run typecheck`, and `npm run build` are run and
 * recorded green in apply-progress.md/tasks.md — those are process
 * gates, not vitest assertions.
 */

async function loadRules(vaultRoot: string): Promise<RulesModel> {
  const raw = await readFile(path.join(vaultRoot, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

async function connectedClient(server: ReturnType<typeof createServer>): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "p2-gate", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function withVault<T>(fn: (vault: TestVault) => Promise<T>): Promise<T> {
  const vault = await createTestVault();
  try {
    return await fn(vault);
  } finally {
    await vault.cleanup();
  }
}

describe("P2 phase gate — contract suite over InMemoryTransport", () => {
  it("lists exactly six tools, none declaring a project argument", async () => {
    await withVault(async (vault) => {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);
      const server = createServer({
        vaultPath: vault.root,
        rules,
        store,
        clock: { now: () => new Date() },
        templates: {},
      });
      const { client, close } = await connectedClient(server);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual(
          ["changes_since", "find", "read_with_context", "save", "status", "sync"].sort(),
        );
        for (const tool of tools) {
          const properties = tool.inputSchema.properties ?? {};
          expect(Object.keys(properties)).not.toContain("project");
        }
      } finally {
        await close();
      }
    });
  });

  it("save schema (end to end) reflects declared required fields — rejects specifically the missing one", async () => {
    await withVault(async (vault) => {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);
      const server = createServer({
        vaultPath: vault.root,
        rules,
        store,
        clock: { now: () => new Date() },
        templates: {},
      });
      const { client, close } = await connectedClient(server);
      try {
        // `decision` requires decision_id — omit it.
        const result = await client.callTool({
          name: "save",
          arguments: { type: "decision", spec_id: "SPEC-x", content: "body" },
        });
        expect(result.isError).toBe(true);
        // Fresh-context review finding 10: asserting isError alone passes
        // for ANY failure cause. Pin the actual cause: the omitted field,
        // decision_id, must be the one named — not some unrelated error.
        const payload = result.structuredContent as { issues?: Array<{ field?: string }> };
        expect(payload.issues?.some((issue) => issue.field === "decision_id")).toBe(true);

        // Triangulate: a decision that DOES supply decision_id (with
        // everything else identical) must succeed — proves the rejection
        // above was really about the missing field, not something else
        // entirely (e.g. spec_id, content, or the tool itself).
        const withId = await client.callTool({
          name: "save",
          arguments: {
            type: "decision",
            decision_id: "DEC-99",
            spec_id: "SPEC-x",
            content: "body",
          },
        });
        expect(withId.isError).toBeFalsy();
      } finally {
        await close();
      }
    });
  });

  it("a rules reload changes generated behavior with no code change (new required field enforced immediately)", async () => {
    await withVault(async (vault) => {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);

      const baselineServer = createServer({
        vaultPath: vault.root,
        rules,
        store,
        clock: { now: () => new Date() },
        templates: {},
      });
      const baseline = await connectedClient(baselineServer);
      const baselineResult = await baseline.client.callTool({
        name: "save",
        arguments: {
          type: "decision",
          decision_id: "DEC-1",
          spec_id: "SPEC-search",
          content: "body",
        },
      });
      await baseline.close();
      expect(baselineResult.isError).toBeFalsy();

      // Reload: same rules, PLUS a new required field — no code change,
      // just a different RulesModel fed through the same createServer.
      const reloadedRules: RulesModel = {
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
      const reloadedServer = createServer({
        vaultPath: vault.root,
        rules: reloadedRules,
        store,
        clock: { now: () => new Date() },
        templates: {},
      });
      const reloaded = await connectedClient(reloadedServer);
      try {
        const reloadedResult = await reloaded.client.callTool({
          name: "save",
          arguments: {
            type: "decision",
            decision_id: "DEC-2",
            spec_id: "SPEC-search",
            content: "body",
          },
        });
        expect(reloadedResult.isError).toBe(true); // now missing the new required `reviewer`
      } finally {
        await reloaded.close();
      }
    });
  });

  it("restart identity: a fresh index build over the same vault reproduces identical find AND read_with_context results, with no index artifact ever written", async () => {
    // Fresh-context review finding 10: the original version of this test
    // compared two builds of an EMPTY, unmodified vault (both sides
    // trivially {results: []}), and never called read_with_context even
    // though the index spec's restart-identity scenario names both
    // "known find/read_with_context results" explicitly. Seed real,
    // linked notes so both tool results are non-trivial.
    const SPEC_NOTE = `---
spec_id: SPEC-restart
status: active
owner: Raul
---

# Restart identity spec

## Linked Knowledge
`;
    const DECISION_NOTE = `---
decision_id: DEC-restart
spec_id: SPEC-restart
status: proposed
---

# Keep the index purely in memory

Links back to [[SPEC-restart]].
`;

    const vault = await createTestVault({
      seedNotes: [
        { path: "specs/SPEC-restart-spec.md", content: SPEC_NOTE },
        { path: "decisions/DEC-restart-index.md", content: DECISION_NOTE },
      ],
    });
    try {
      const rules = await loadRules(vault.root);

      const firstStore = await buildIndex(vault.root, rules);
      const firstServer = createServer({
        vaultPath: vault.root,
        rules,
        store: firstStore,
        clock: { now: () => new Date() },
        templates: {},
      });
      const first = await connectedClient(firstServer);
      const firstFind = await first.client.callTool({ name: "find", arguments: {} });
      const firstRead = await first.client.callTool({
        name: "read_with_context",
        arguments: { id: "SPEC-restart" },
      });
      await first.close();

      // Non-trivial: prove the seeded notes actually came through before
      // comparing — an accidental empty result on both sides would make
      // the equality check below pass vacuously.
      const firstFindPayload = firstFind.structuredContent as { results: unknown[] };
      expect(firstFindPayload.results.length).toBeGreaterThan(0);
      const firstReadPayload = firstRead.structuredContent as { backlinks: unknown[] };
      expect(firstReadPayload.backlinks.length).toBeGreaterThan(0);

      // Simulate a restart: build a brand new store from the same vault.
      const secondStore = await buildIndex(vault.root, rules);
      const secondServer = createServer({
        vaultPath: vault.root,
        rules,
        store: secondStore,
        clock: { now: () => new Date() },
        templates: {},
      });
      const second = await connectedClient(secondServer);
      const secondFind = await second.client.callTool({ name: "find", arguments: {} });
      const secondRead = await second.client.callTool({
        name: "read_with_context",
        arguments: { id: "SPEC-restart" },
      });
      await second.close();

      expect(secondFind.structuredContent).toEqual(firstFind.structuredContent);
      expect(secondRead.structuredContent).toEqual(firstRead.structuredContent);

      const status = await vault.git.status();
      expect(status.isClean()).toBe(true);
    } finally {
      await vault.cleanup();
    }
  });

  it("incremental visibility: a saved note is immediately findable through the same running server, no restart", async () => {
    await withVault(async (vault) => {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);
      const server = createServer({
        vaultPath: vault.root,
        rules,
        store,
        clock: { now: () => new Date() },
        templates: {},
      });
      const { client, close } = await connectedClient(server);
      try {
        const saveResult = await client.callTool({
          name: "save",
          arguments: {
            type: "decision",
            decision_id: "DEC-3",
            spec_id: "SPEC-search",
            content: "# Live-saved decision\n",
          },
        });
        expect(saveResult.isError).toBeFalsy();

        const found = await client.callTool({ name: "find", arguments: { type: "decision" } });
        const payload = found.structuredContent as { results: Array<{ id: string }> };
        expect(payload.results.map((r) => r.id)).toContain("DEC-3");
      } finally {
        await close();
      }
    });
  });
});
