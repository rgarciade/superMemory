#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { AppError } from "../util/errors.js";
import { registerInitCommand } from "./commands/init.js";
import { registerServeCommand } from "./commands/serve.js";
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
  registerServeCommand(program);
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

function isCommanderExit(err: unknown): err is CommanderError {
  // Must be a real CommanderError, not merely "any Error with a string
  // `code`" — Node fs errors (EACCES, ENOSPC, ENOTDIR, ...) also carry a
  // string `code` and must fall through to the generic error path so
  // their message reaches stderr instead of being silently swallowed.
  return err instanceof CommanderError;
}

async function main(): Promise<void> {
  const program = buildProgram();
  const exitCode = await runMain(program, process.argv.slice(2));
  process.exitCode = exitCode;
}

/**
 * True when this module was invoked directly as the CLI entry point
 * (`node dist/cli/index.js`, `tsx src/cli/index.ts`), including through
 * an npm bin symlink (global install, `npx`, `npm link`,
 * `node_modules/.bin`). Node resolves `import.meta.url` to the module's
 * realpath, but `argv[1]` keeps the path as invoked (the symlink) — so
 * `argv1` is resolved to its realpath before comparing, or the two would
 * never match and the CLI would silently no-op.
 */
export function isInvokedAsBin(
  argv1: string | undefined,
  moduleUrl: string,
): boolean {
  if (argv1 === undefined) return false;
  let resolvedArgv1: string;
  try {
    resolvedArgv1 = realpathSync(argv1);
  } catch {
    return false;
  }
  return moduleUrl === pathToFileURL(resolvedArgv1).href;
}

if (isInvokedAsBin(process.argv[1], import.meta.url)) {
  await main();
}
