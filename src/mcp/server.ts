import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../../package.json" with { type: "json" };
import { validateBoot } from "../boot/validate-boot.js";
import { loadVaultConfig, resolveSyncTunables } from "../config/vault-config.js";
import { loadGlobalConfig, resolveDefaultVault, type GlobalConfig } from "../config/global-config.js";
import { ENV_KEYS, ProcessEnvSource, readString, type EnvSource } from "../config/env.js";
import { buildIndex } from "../index/build.js";
import { generateIndexMaps } from "../index/maps.js";
import { listNotes } from "../index/queries.js";
import type { IndexStore } from "../index/store.js";
import { reparseFiles } from "../index/upsert.js";
import { createNullSyncPort } from "../notes/save-pipeline.js";
import { loadRules } from "../rules/parser.js";
import type { RulesModel } from "../rules/types.js";
import { createSyncEngine, type IndexPort, type SyncEngine } from "../sync/engine.js";
import { createGitClient, type CommitAuthor } from "../sync/git.js";
import { PidfileLock, type LockOwner } from "../sync/lock.js";
import { createSyncScheduler, type SyncScheduler } from "../sync/scheduler.js";
import { AppError, NO_VAULT_CONFIGURED_MESSAGE } from "../util/errors.js";
import { SystemClock, SystemTimerPort, type Clock } from "../util/clock.js";
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
      saveSchemas: catalog.saveSchemas,
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
 * The engine's index seam (OD-5), wired to the REAL implementations: a
 * post-pull `reparse` re-parses exactly git's changed paths (never a full
 * re-walk, `index/upsert.ts`), and `regenerateMaps` deterministically
 * rewrites only the `index/` files whose content changed — the engine's
 * separate `chore(index)` commit (design §4.1 step 6).
 *
 * Composition-root glue: `mcp → index` and `mcp → sync` are both
 * sanctioned edges (design §1.3); this is what makes the injected port
 * concrete. Rules are read through `getRules` so a post-sync reload is
 * reflected immediately (the engine's `onRulesReloaded` swaps the box).
 */
export function createVaultIndexPort(
  store: IndexStore,
  vaultPath: string,
  getRules: () => RulesModel,
): IndexPort {
  return {
    async reparse(paths: string[]): Promise<unknown> {
      return reparseFiles(store, vaultPath, getRules(), paths);
    },

    async regenerateMaps(): Promise<{ changedPaths: string[]; noteCount: number }> {
      const changedPaths: string[] = [];
      for (const map of generateIndexMaps(store)) {
        const abs = path.join(vaultPath, map.path);
        let existing: string | undefined;
        try {
          existing = await readFile(abs, "utf8");
        } catch {
          // New map — no prior content on disk.
        }
        if (existing !== map.content) {
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, map.content, "utf8");
          changedPaths.push(map.path);
        }
      }
      return { changedPaths, noteCount: listNotes(store).length };
    },
  };
}

/**
 * The human commit identity (design §4.3): global-config `author` — what
 * `setup` writes — becomes the git AUTHOR of every engine/resolve commit,
 * so `git blame` shows people. Absent (setup not run) ⇒ undefined, and
 * commits inherit the vault's own git identity.
 */
export function authorFromConfig(config: GlobalConfig): CommitAuthor | undefined {
  const name = config.author?.name;
  const email = config.author?.email;
  return name && email ? { name, email } : undefined;
}

export interface SyncStackOptions {
  vaultPath: string;
  rules: RulesModel;
  store: IndexStore;
  clock: Clock;
  env: EnvSource;
  /** The human identity — git author of sync commits (design §4.3). */
  author?: CommitAuthor;
  /** Which actor this engine runs as (OD-4). Default "server". */
  owner?: LockOwner;
}

export interface SyncStack {
  engine: SyncEngine;
  scheduler: SyncScheduler;
}

/**
 * The production sync assembly shared by `serve` and `supermemory sync`
 * (design §5.1 step 4, §4.2): the real pidfile lock, the real git client,
 * the real index port (`createVaultIndexPort`), tunables resolved per
 * §3.2, and a TimerPort-based scheduler. The engine's post-sync rules
 * hook swaps the current-rules box, so the index port and the tunables
 * provider always see the reloaded model (design §3.1).
 *
 * The scheduler is returned INERT: `serveVault` starts it for the process
 * lifetime; the CLI runs a single `runCycle('manual')` and never starts
 * one (design §4.2).
 */
export async function createVaultSyncStack(opts: SyncStackOptions): Promise<SyncStack> {
  const paths = vaultPaths(opts.vaultPath);
  const vaultConfig = await loadVaultConfig(paths.configPath);
  let currentRules = opts.rules;
  const tunables = () => resolveSyncTunables(opts.env, vaultConfig, currentRules);

  const engine = createSyncEngine({
    vaultPath: opts.vaultPath,
    store: opts.store,
    rules: opts.rules,
    tunables,
    clock: opts.clock,
    timer: new SystemTimerPort(),
    lock: new PidfileLock({ vaultRoot: opts.vaultPath }),
    git: createGitClient(opts.vaultPath),
    index: createVaultIndexPort(opts.store, opts.vaultPath, () => currentRules),
    reloadRules: () => loadRules(paths.rulesPath),
    resolveTunables: (rules) => resolveSyncTunables(opts.env, vaultConfig, rules),
    onRulesReloaded: (rules) => {
      currentRules = rules;
    },
    author: opts.author,
    owner: opts.owner,
  });

  const scheduler = createSyncScheduler({
    runCycle: engine.runCycle,
    tunables,
    timer: new SystemTimerPort(),
    clock: opts.clock,
  });

  return { engine, scheduler };
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
