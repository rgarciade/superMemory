import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import { buildProgram, isInvokedAsBin, runMain } from "../../src/cli/index.js";
import { AppError } from "../../src/util/errors.js";

// Task 1.16 [RED first]: commander program — subcommand registration,
// parseAsync, AppError -> stderr + exit code, help/version.
describe("buildProgram", () => {
  it("registers the P1 subcommands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("init");
    expect(names).toContain("setup");
  });

  // Task 2.17: serve wired into the composition root alongside init/setup.
  it("registers the P2 serve subcommand", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("serve");
  });

  // Task 3.11: sync wired into the composition root (the manual trigger).
  it("registers the P3 sync subcommand", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("sync");
  });

  // Task 3.12: resolve wired into the composition root (guided conflicts).
  it("registers the P3 resolve subcommand", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("resolve");
  });

  it("exposes help and version", () => {
    const program = buildProgram();
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("runMain", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns exit code 0 and runs nothrow for a valid command path", async () => {
    const program = new Command();
    program.command("ok").action(() => {});
    const exit = await runMain(program, ["ok"], { stderr: () => {} });
    expect(exit).toBe(0);
  });

  it("an AppError prints code+message+hint to stderr and exits 1", async () => {
    const program = new Command();
    program.command("boom").action(() => {
      throw new AppError("BOOT_VALIDATION_FAILED", "vault check failed", {
        hint: "run supermemory setup",
      });
    });
    const errLines: string[] = [];
    const exit = await runMain(program, ["boom"], {
      stderr: (line) => errLines.push(line),
    });
    expect(exit).toBe(1);
    expect(errLines.join("\n")).toContain("BOOT_VALIDATION_FAILED");
    expect(errLines.join("\n")).toContain("vault check failed");
    expect(errLines.join("\n")).toContain("run supermemory setup");
  });

  it("commander argument errors exit 1 without throwing", async () => {
    const program = new Command();
    program
      .command("need")
      .argument("<value>", "a value")
      .action(() => {});
    const errLines: string[] = [];
    const exit = await runMain(program, ["need"], {
      stderr: (line) => errLines.push(line),
    });
    expect(exit).toBe(1);
  });

  it("unknown commands exit 1", async () => {
    const exit = await runMain(buildProgram(), ["definitely-not-a-command"], {
      stderr: () => {},
    });
    expect(exit).toBe(1);
  });

  it("does not swallow a non-commander error that happens to carry a string `code` (e.g. Node fs errors)", async () => {
    const program = new Command();
    program.command("fsboom").action(() => {
      const err = new Error("EACCES: permission denied, open 'x'") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    });
    const errLines: string[] = [];
    const exit = await runMain(program, ["fsboom"], {
      stderr: (line) => errLines.push(line),
    });
    expect(exit).toBe(1);
    // Old bug: isCommanderExit matched any Error with a string `code`,
    // so this returned exit 1 with EMPTY stderr. The real cause must be
    // surfaced instead of silently swallowed.
    expect(errLines.join("\n")).toContain("EACCES");
  });

  it("a real CommanderError (not just anything with a string code) still exits with its own code silently", async () => {
    const program = new Command();
    program.command("usage-error").action(() => {
      throw new CommanderError(2, "commander.usageError", "bad usage");
    });
    const errLines: string[] = [];
    const exit = await runMain(program, ["usage-error"], {
      stderr: (line) => errLines.push(line),
    });
    expect(exit).toBe(2);
  });
});

describe("isInvokedAsBin", () => {
  it("returns false when argv[1] is undefined", () => {
    expect(isInvokedAsBin(undefined, "file:///real/module.js")).toBe(false);
  });

  it("returns false for an unrelated module path", () => {
    expect(isInvokedAsBin("/some/other/file.js", "file:///real/module.js")).toBe(
      false,
    );
  });

  it("returns true when argv[1] is a symlink resolving to the module's real path (npm bin / npx / npm link)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sm-bin-symlink-"));
    try {
      const real = path.join(dir, "real-entry.mjs");
      await writeFile(real, "export {};\n", "utf8");
      const link = path.join(dir, "bin-symlink.mjs");
      await symlink(real, link);
      // import.meta.url reflects the module's realpath once loaded, per
      // Node's default (non --preserve-symlinks) ESM resolution.
      const moduleUrl = pathToFileURL(await realpath(real)).href;

      expect(isInvokedAsBin(link, moduleUrl)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
