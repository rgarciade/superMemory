import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildIndex } from "../../src/index/build.js";
import { createServer, resolveVaultPath } from "../../src/mcp/server.js";
import { RULES_RESOURCE_URI } from "../../src/mcp/resources.js";
import { NO_VAULT_CONFIGURED_MESSAGE, AppError } from "../../src/util/errors.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import { saveGlobalConfig, type GlobalConfig } from "../../src/config/global-config.js";
import type { EnvSource } from "../../src/config/env.js";
import { createTestVault, type TestVault } from "../helpers/create-test-vault.js";
import { fakeEngine } from "../helpers/fake-engine.js";

// Task 2.16 [RED first]: server.ts — vault resolution, boot composition
// (pure createServer, tested over InMemoryTransport), the exact
// NO_VAULT_CONFIGURED message contract (design §5.1).

function fakeEnv(values: Record<string, string | undefined>): EnvSource {
  return { get: (name) => values[name] };
}

async function loadRules(vaultRoot: string): Promise<RulesModel> {
  const raw = await readFile(path.join(vaultRoot, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

describe("resolveVaultPath", () => {
  it("prefers the --vault flag over everything else", async () => {
    const env = fakeEnv({ SUPERMEMORY_VAULT: "/from/env", SUPERMEMORY_CONFIG_DIR: "/tmp/nope" });
    const resolved = await resolveVaultPath("/from/flag", env);
    expect(resolved).toBe("/from/flag");
  });

  it("falls back to SUPERMEMORY_VAULT when no flag is given", async () => {
    const env = fakeEnv({ SUPERMEMORY_VAULT: "/from/env" });
    const resolved = await resolveVaultPath(undefined, env);
    expect(resolved).toBe("/from/env");
  });

  it("falls back to vaults.default in global config when neither flag nor env is set", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "supermemory-config-"));
    const env = fakeEnv({ SUPERMEMORY_CONFIG_DIR: configDir });
    const config: GlobalConfig = { vaults: { default: "/from/config" } };
    await saveGlobalConfig(env, config);

    const resolved = await resolveVaultPath(undefined, env);
    expect(resolved).toBe("/from/config");
  });

  it("fails with the exact spec-mandated message when nothing resolves", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "supermemory-config-"));
    const env = fakeEnv({ SUPERMEMORY_CONFIG_DIR: configDir });

    await expect(resolveVaultPath(undefined, env)).rejects.toThrow(AppError);
    try {
      await resolveVaultPath(undefined, env);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).message).toBe(NO_VAULT_CONFIGURED_MESSAGE);
    }
  });

  // Fresh-context review finding 5: the assertion above compares against
  // the imported constant, so it would still pass even if
  // NO_VAULT_CONFIGURED_MESSAGE's value drifted from the spec wording —
  // tautological. Pin the literal spec-mandated string directly.
  it("fails with the byte-exact literal spec wording, independent of the imported constant", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "supermemory-config-"));
    const env = fakeEnv({ SUPERMEMORY_CONFIG_DIR: configDir });

    try {
      await resolveVaultPath(undefined, env);
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).message).toBe("No vault configured. Run: supermemory setup");
    }
  });
});

describe("createServer", () => {
  async function setup(engine = fakeEngine()): Promise<{
    vault: TestVault;
    rules: RulesModel;
    server: ReturnType<typeof createServer>;
  }> {
    const vault = await createTestVault();
    const rules = await loadRules(vault.root);
    const store = await buildIndex(vault.root, rules);
    const server = createServer({
      vaultPath: vault.root,
      rules,
      store,
      clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
      templates: {},
      engine,
    });
    return { vault, rules, server };
  }

  it("registers exactly the six M1 tools", async () => {
    const { vault, server } = await setup();
    try {
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test", version: "0.0.0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual(
        ["changes_since", "find", "read_with_context", "save", "status", "sync"].sort(),
      );
      await client.close();
      await server.close();
    } finally {
      await vault.cleanup();
    }
  });

  it("exposes the rules://current resource with the parsed rules", async () => {
    const { vault, server } = await setup();
    try {
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test", version: "0.0.0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const resource = await client.readResource({ uri: RULES_RESOURCE_URI });
      const first = resource.contents[0];
      expect(first?.mimeType).toBe("application/json");
      if (!first || !("text" in first)) throw new Error("expected a text resource content");
      const parsed = JSON.parse(first.text) as { formatVersion: string };
      expect(parsed.formatVersion).toBeTruthy();
      await client.close();
      await server.close();
    } finally {
      await vault.cleanup();
    }
  });

  it("wires save and find end to end through the composed server", async () => {
    const { vault, server } = await setup();
    try {
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test", version: "0.0.0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const saveResult = await client.callTool({
        name: "save",
        arguments: {
          type: "decision",
          decision_id: "DEC-1",
          spec_id: "SPEC-search",
          status: "proposed",
          content: "# Use an in-memory index\n",
        },
      });
      expect(saveResult.isError).toBeFalsy();

      const findResult = await client.callTool({ name: "find", arguments: { type: "decision" } });
      const payload = findResult.structuredContent as { results: Array<{ id: string }> };
      expect(payload.results.map((r) => r.id)).toContain("DEC-1");

      await client.close();
      await server.close();
    } finally {
      await vault.cleanup();
    }
  });

  // Task 3.13 wiring: the save pipeline's SyncPort IS the engine — a
  // create journals a write event (Via: mcp), an update pulls first.
  it("routes saves through the engine SyncPort: notifyWrite journaled, update pulls before write", async () => {
    const engine = fakeEngine();
    const { vault, server } = await setup(engine);
    try {
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test", version: "0.0.0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const created = await client.callTool({
        name: "save",
        arguments: {
          type: "decision",
          decision_id: "DEC-1",
          spec_id: "SPEC-search",
          content: "body",
        },
      });
      expect(created.isError).toBeFalsy();
      // Create: journaled, no pull-before-write.
      expect(engine.writes).toHaveLength(1);
      expect(engine.writes[0]).toMatchObject({ op: "add", type: "decision", via: "mcp" });
      expect(engine.pulls).toEqual([]);

      const updated = await client.callTool({
        name: "save",
        arguments: {
          type: "decision",
          decision_id: "DEC-1",
          spec_id: "SPEC-search",
          content: "body v2",
        },
      });
      expect(updated.isError).toBeFalsy();
      // Update: pull-before-write ran for the note's path, then journal.
      expect(engine.pulls).toEqual(["decisions/DEC-1-untitled.md"]);
      expect(engine.writes).toHaveLength(2);
      expect(engine.writes[1]).toMatchObject({ op: "update" });

      await client.close();
      await server.close();
    } finally {
      await vault.cleanup();
    }
  });
});
