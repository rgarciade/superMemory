import { describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerServeCommand } from "../../../src/cli/commands/serve.js";

// Task 2.17 [RED first]: serve — `--vault` flag, never interactive,
// delegates to server boot (design §5.1).

describe("registerServeCommand", () => {
  it("registers a serve subcommand", () => {
    const program = new Command();
    registerServeCommand(program, vi.fn(async () => {}));
    const serve = program.commands.find((c) => c.name() === "serve");
    expect(serve).toBeDefined();
  });

  it("passes the --vault flag through to server boot", async () => {
    const program = new Command().exitOverride();
    const serve = vi.fn(async () => {});
    registerServeCommand(program, serve);

    await program.parseAsync(["serve", "--vault", "/path/to/vault"], { from: "user" });

    expect(serve).toHaveBeenCalledWith({ vaultFlag: "/path/to/vault" });
  });

  it("boots with an undefined vaultFlag when --vault is omitted (falls through to env/config)", async () => {
    const program = new Command().exitOverride();
    const serve = vi.fn(async () => {});
    registerServeCommand(program, serve);

    await program.parseAsync(["serve"], { from: "user" });

    expect(serve).toHaveBeenCalledWith({ vaultFlag: undefined });
  });

  it("never prompts — the action resolves without any interactive input", async () => {
    const program = new Command().exitOverride();
    const serve = vi.fn(async () => {});
    registerServeCommand(program, serve);

    // No stdin is provided to this process during the test; if the
    // command tried to prompt, it would hang. Resolving proves it never did.
    await expect(program.parseAsync(["serve"], { from: "user" })).resolves.toBe(program);
    expect(serve).toHaveBeenCalledOnce();
  });
});
