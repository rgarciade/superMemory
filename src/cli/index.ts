#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { AppError } from "../util/errors.js";
import { registerInitCommand } from "./commands/init.js";
import { registerSetupCommand } from "./commands/setup.js";

/**
 * The bin entry (OD-1: commander). Builds the program, registers
 * subcommands (composition root — P2 adds serve, P3 adds sync/resolve),
 * and funnels every failure into the AppError -> stderr + exit-code
 * contract. stdout stays clean for the MCP protocol in `serve`.
 */

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("supermemory")
    .description(
      "A team knowledge layer over a git-synced Obsidian vault (MCP server + CLI).",
    )
    .version(pkg.version);
  registerInitCommand(program);
  registerSetupCommand(program);
  return program;
}

export interface MainIo {
  stderr(line: string): void;
}

/**
 * Parses `argv` (user args, e.g. ["init", "."]) and returns the process
 * exit code; never throws. AppErrors print code + message + hint.
 */
export async function runMain(
  program: Command,
  argv: string[],
  io: MainIo = { stderr: (line) => console.error(line) },
): Promise<number> {
  program
    .exitOverride()
    .configureOutput({ writeErr: (chunk) => io.stderr(chunk.trimEnd()) });
  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (err) {
    if (err instanceof AppError) {
      io.stderr(err.toString());
      return 1;
    }
    if (isCommanderExit(err)) {
      // --help/-V exit 0; usage errors already went to stderr via writeErr
      return err.exitCode ?? 1;
    }
    io.stderr(
      err instanceof Error
        ? `supermemory: unexpected error — ${err.message}`
        : "supermemory: unexpected error",
    );
    return 1;
  }
}

interface CommanderExit extends Error {
  code?: string;
  exitCode?: number;
}

function isCommanderExit(err: unknown): err is CommanderExit {
  return (
    err instanceof Error &&
    "code" in err &&
    typeof (err as CommanderExit).code === "string"
  );
}

async function main(): Promise<void> {
  const program = buildProgram();
  const exitCode = await runMain(program, process.argv.slice(2));
  process.exitCode = exitCode;
}

// Run only when executed as the bin (node dist/cli/index.js / tsx src/cli/index.ts).
const invokedAsBin =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsBin) {
  await main();
}
