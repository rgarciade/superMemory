import type { Command } from "commander";
import { serveVault, type ServeOptions } from "../../mcp/server.js";

/**
 * `supermemory serve` — boots the MCP server over stdio (design §5.1).
 * NEVER interactive (RFC §7.2): a missing/invalid vault fails fast with
 * an `AppError`, never a prompt — `setup` is the interactive surface,
 * this command is not. `--vault` optionally overrides the resolved vault
 * (flag → `SUPERMEMORY_VAULT` → `vaults.default`).
 */

export function registerServeCommand(
  program: Command,
  serve: (opts: ServeOptions) => Promise<void> = serveVault,
): void {
  program
    .command("serve")
    .description("Boot the MCP server over stdio for the resolved vault.")
    .option(
      "--vault <path>",
      "vault path or configured name (overrides SUPERMEMORY_VAULT / vaults.default)",
    )
    .action(async (opts: { vault?: string }) => {
      await serve({ vaultFlag: opts.vault });
    });
}
