import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../../package.json" with { type: "json" };
import { validateBoot } from "../boot/validate-boot.js";
import { loadGlobalConfig, resolveDefaultVault } from "../config/global-config.js";
import { ENV_KEYS, ProcessEnvSource, readString, type EnvSource } from "../config/env.js";
import { buildIndex } from "../index/build.js";
import type { IndexStore } from "../index/store.js";
import { createNullSyncPort } from "../notes/save-pipeline.js";
import { loadRules } from "../rules/parser.js";
import type { RulesModel } from "../rules/types.js";
import { AppError, NO_VAULT_CONFIGURED_MESSAGE } from "../util/errors.js";
import { SystemClock, type Clock } from "../util/clock.js";
import { createLogger } from "../util/log.js";
import { vaultPaths } from "../util/paths.js";
import { buildCatalog } from "./catalog.js";
import {
  buildRulesResourceContent,
  loadTemplates,
  readAgentInstructions,
  RULES_RESOURCE_URI,
} from "./resources.js";
import { createChangesSinceHandler } from "./tools/changes-since.js";
import { createFindHandler } from "./tools/find.js";
import { createReadWithContextHandler } from "./tools/read-with-context.js";
import { createSaveHandler } from "./tools/save.js";
import { createStatusHandler } from "./tools/status.js";
import { createSyncHandler } from "./tools/sync.js";

/**
 * The MCP server composition root (design §5.1). Split in two:
 *
 * - `createServer(deps)` is a PURE assembly function — catalog + tool
 *   handlers + the rules resource, all wired onto a fresh `McpServer`.
 *   No I/O. This is what contract tests (2.11-2.15, this file's own
 *   tests, and 2.18's phase gate) exercise directly over
 *   `InMemoryTransport`.
 * - `serveVault(opts)` is the actual boot I/O: resolve the vault →
 *   `validateBoot` → `loadRules` → build the in-memory index (OD-5,
 *   always from a fresh vault walk, never loaded from disk) → load
 *   templates/instructions → `createServer` → serve over stdio.
 *
 * P2 scope note: no lock acquisition and no engine/scheduler start here
 * — `src/sync/lock.ts` and the sync engine are P3. `sync`/`status` are
 * documented stubs (2.15) until then.
 */

export interface ServerDeps {
  vaultPath: string;
  rules: RulesModel;
  store: IndexStore;
  clock: Clock;
  templates: Record<string, string>;
  instructions?: string;
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: "supermemory", version: pkg.version },
    deps.instructions !== undefined ? { instructions: deps.instructions } : undefined,
  );

  const catalog = buildCatalog(deps.rules);
  // P2: no engine yet (P3) — the save pipeline gets a null SyncPort, the
  // exact P2->P3 seam design §1.3 describes.
  const syncPort = createNullSyncPort();

  const handlers: Record<string, (args: never) => CallToolResult | Promise<CallToolResult>> = {
    find: createFindHandler({ store: deps.store }) as (args: never) => CallToolResult,
    read_with_context: createReadWithContextHandler({ store: deps.store }) as (
      args: never,
    ) => CallToolResult,
    save: createSaveHandler({
      vaultPath: deps.vaultPath,
      rules: deps.rules,
      store: deps.store,
      clock: deps.clock,
      syncPort,
      via: "mcp",
    }) as (args: never) => Promise<CallToolResult>,
    changes_since: createChangesSinceHandler({ vaultPath: deps.vaultPath }) as (
      args: never,
    ) => Promise<CallToolResult>,
    sync: createSyncHandler({ store: deps.store, rules: deps.rules, clock: deps.clock }) as (
      args: never,
    ) => CallToolResult,
    status: createStatusHandler({ store: deps.store, rules: deps.rules, clock: deps.clock }) as (
      args: never,
    ) => CallToolResult,
  };

  for (const tool of catalog.tools) {
    const handler = handlers[tool.name];
    if (!handler) continue; // unreachable given buildCatalog's fixed TOOL_NAMES, guarded for type safety
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema as never },
      handler as never,
    );
  }

  const resourceContent = buildRulesResourceContent(deps.rules, deps.templates);
  server.registerResource(
    "rules",
    RULES_RESOURCE_URI,
    {
      mimeType: "application/json",
      description: "The vault's parsed rules and note templates.",
    },
    (uri): ReadResourceResult => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(resourceContent, null, 2),
        },
      ],
    }),
  );

  return server;
}

/**
 * Vault resolution order (design §5.1): `--vault` flag → `SUPERMEMORY_VAULT`
 * → `vaults.default` in global config. Unresolvable ⇒ fails with EXACTLY
 * `No vault configured. Run: supermemory setup` (spec-mandated wording).
 */
export async function resolveVaultPath(vaultFlag: string | undefined, env: EnvSource): Promise<string> {
  if (vaultFlag) return vaultFlag;

  const fromEnv = readString(env, ENV_KEYS.vault);
  if (fromEnv) return fromEnv;

  const globalConfig = await loadGlobalConfig(env);
  const fromConfig = resolveDefaultVault(globalConfig);
  if (fromConfig) return fromConfig;

  throw new AppError("NO_VAULT_CONFIGURED", NO_VAULT_CONFIGURED_MESSAGE, {
    hint: "Run `supermemory setup` to configure a default vault, or pass --vault.",
  });
}

export interface ServeOptions {
  vaultFlag?: string;
  env?: EnvSource;
  clock?: Clock;
}

/** Resolves the vault, validates boot, builds the server, and serves over stdio (never interactive). */
export async function serveVault(opts: ServeOptions = {}): Promise<void> {
  const env = opts.env ?? new ProcessEnvSource();
  const clock = opts.clock ?? new SystemClock();
  const log = createLogger();

  const vaultPath = await resolveVaultPath(opts.vaultFlag, env);
  await validateBoot(vaultPath);

  const paths = vaultPaths(vaultPath);
  const rules = await loadRules(paths.rulesPath);

  const [store, templates, instructions] = await Promise.all([
    buildIndex(vaultPath, rules),
    loadTemplates(vaultPath, rules),
    readAgentInstructions(vaultPath),
  ]);

  const server = createServer({
    vaultPath,
    rules,
    store,
    clock,
    templates,
    ...(instructions !== undefined ? { instructions } : {}),
  });

  log.info(`serving vault at ${vaultPath}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
