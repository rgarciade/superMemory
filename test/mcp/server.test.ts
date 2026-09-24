import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildIndex } from "../../src/index/build.js";
import { createServer, serveVault } from "../../src/mcp/server.js";
import {
  loadProjectConfig,
  projectAuthor,
  resolveVaultPath,
} from "../../src/config/project-config.js";
import { RULES_RESOURCE_URI } from "../../src/mcp/resources.js";
import { NO_VAULT_CONFIGURED_MESSAGE, AppError } from "../../src/util/errors.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import type { EnvSource } from "../../src/config/env.js";
import { createTestVault, type TestVault } from "../helpers/create-test-vault.js";
import { fakeEngine } from "../helpers/fake-engine.js";
import { makeProjectDir } from "../helpers/project.js";

// Task 2.16 [RED first], migrated by add-project-config W3 (task 3.1):
// vault resolution is owned by config/project-config (the chain
// serveVault itself boots through); the global-config fallback tests
// became project-file tests (makeProjectDir + basePath), the
// subdir-launch case pins AD-1 discovery, and the byte-pinned error
// literal stays verbatim. Boot composition (pure createServer) is
// tested over InMemoryTransport; the exact NO_VAULT_CONFIGURED message
// contract is pinned below (design §5.1).

function fakeEnv(values: Record<string, string | undefined>): EnvSource {
  return { get: (name) => values[name] };
}

async function loadRules(vaultRoot: string): Promise<RulesModel> {
  const raw = await readFile(path.join(vaultRoot, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

describe("resolveVaultPath", () => {
  it("prefers the --vault flag over everything else", async () => {
    const env = fakeEnv({ SUPERMEMORY_VAULT: "/from/env" });
    const project = await makeProjectDir({ config: { vault: "/from/project" } });
    try {
      const resolved = await resolveVaultPath({
        vaultFlag: "/from/flag",
        env,
        basePath: project.root,
      });
      expect(resolved).toBe("/from/flag");
    } finally {
      await project.cleanup();
    }
  });

  it("falls back to SUPERMEMORY_VAULT when no flag is given", async () => {
    const env = fakeEnv({ SUPERMEMORY_VAULT: "/from/env" });
    const project = await makeProjectDir(); // work tree, no config file
    try {
      const resolved = await resolveVaultPath({
        vaultFlag: undefined,
        env,
        basePath: project.root,
      });
      expect(resolved).toBe("/from/env");
    } finally {
      await project.cleanup();
    }
  });

  it("falls back to the project file's vault when neither flag nor env is set", async () => {
    const env = fakeEnv({});
    const project = await makeProjectDir({ config: { vault: "/from/config" } });
    try {
      const resolved = await resolveVaultPath({
        vaultFlag: undefined,
        env,
        basePath: project.root,
      });
      expect(resolved).toBe("/from/config");
    } finally {
      await project.cleanup();
    }
  });

  // AD-1: discovery walks up to the nearest Git work-tree root, so a
  // launch from a subdirectory (e.g. a monorepo workspace spawn) finds
  // the file setup wrote at the root — through the same chain
  // serveVault boots with.
  it("resolves the root project file from a subdirectory launch", async () => {
    const env = fakeEnv({});
    const project = await makeProjectDir({
      config: { vault: "/from/root-config" },
      nested: "packages/foo",
    });
    const subdir = project.subdir;
    if (subdir === undefined) throw new Error("fixture: nested subdir missing");
    try {
      const resolved = await resolveVaultPath({
        vaultFlag: undefined,
        env,
        basePath: subdir,
      });
      expect(resolved).toBe("/from/root-config");
    } finally {
      await project.cleanup();
    }
  });

  // AD-7: the boot's commit identity comes from the same project file
  // the chain reads — present ⇒ the configured human; absent ⇒
  // undefined, and commits inherit the vault's Git identity.
  it("exposes the project file's author as the boot commit identity", async () => {
    const project = await makeProjectDir({
      config: {
        vault: "/from/config",
        author: { name: "Raul", email: "raul@example.com" },
      },
    });
    try {
      const config = await loadProjectConfig(project.root);
      expect(projectAuthor(config)).toEqual({ name: "Raul", email: "raul@example.com" });

      const bare = await makeProjectDir({ config: { vault: "/from/config" } });
      try {
        expect(projectAuthor(await loadProjectConfig(bare.root))).toBeUndefined();
      } finally {
        await bare.cleanup();
      }
    } finally {
      await project.cleanup();
    }
  });

  it("fails with the exact spec-mandated message when nothing resolves", async () => {
    const env = fakeEnv({});
    const bare = await mkdtemp(path.join(os.tmpdir(), "sm-unconfigured-"));
    try {
      await expect(
        resolveVaultPath({ vaultFlag: undefined, env, basePath: bare }),
      ).rejects.toThrow(AppError);
      try {
        await resolveVaultPath({ vaultFlag: undefined, env, basePath: bare });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).message).toBe(NO_VAULT_CONFIGURED_MESSAGE);
      }
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  // Fresh-context review finding 5: the assertion above compares against
  // the imported constant, so it would still pass even if
  // NO_VAULT_CONFIGURED_MESSAGE's value drifted from the spec wording —
  // tautological. Pin the literal spec-mandated string directly.
  // (add-project-config 3.1: only the fixture — empty tmp dir +
  // fakeEnv({}) — and the import changed; the pin is verbatim.)
  it("fails with the byte-exact literal spec wording, independent of the imported constant", async () => {
    const env = fakeEnv({});
    const bare = await mkdtemp(path.join(os.tmpdir(), "sm-unconfigured-"));
    try {
      try {
        await resolveVaultPath({ vaultFlag: undefined, env, basePath: bare });
        expect.unreachable();
      } catch (err) {
        expect((err as AppError).message).toBe("No vault configured. Run: supermemory setup");
      }
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});

describe("serveVault boot resolution", () => {
  // Boot-validation delta (add-project-config): unconfigured environment
  // yields the setup command — the SERVER fails fast before serving
  // anything. The chain (flag → SUPERMEMORY_VAULT → project file at
  // basePath) has nothing to resolve in a bare launch tree with an
  // empty env, so boot must end in the pinned error, never stdio.
  it("fails fast with the pinned message when the launch tree configures no vault", async () => {
    const bare = await mkdtemp(path.join(os.tmpdir(), "sm-unconfigured-"));
    try {
      await expect(serveVault({ env: fakeEnv({}), basePath: bare })).rejects.toMatchObject({
        code: "NO_VAULT_CONFIGURED",
        message: NO_VAULT_CONFIGURED_MESSAGE,
      });
    } finally {
      await rm(bare, { recursive: true, force: true });
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
