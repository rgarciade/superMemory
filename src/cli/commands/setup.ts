import type { Command } from "commander";
import { AppError } from "../../util/errors.js";

/**
 * `supermemory setup` — interactive onboarding wizard (OD-1:
 * @inquirer/prompts): validated vault path, author identity, writes the
 * global config (`vaults.default`). Remediation target of
 * `No vault configured. Run: supermemory setup`. The full implementation
 * lands in task 1.18; this registration wires the commander surface.
 */
export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("One-time wizard: point supermemory at your vault and identity.")
    .action(async () => {
      throw new AppError(
        "BOOT_VALIDATION_FAILED",
        "`supermemory setup` is not implemented in this slice yet (task 1.18).",
        { hint: "This build wires the CLI surface only." },
      );
    });
}
