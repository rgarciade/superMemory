import { describe, expect, it, vi, afterEach } from "vitest";
import { Command } from "commander";
import { buildProgram, runMain } from "../../src/cli/index.js";
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
});
