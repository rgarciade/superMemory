import type { Command } from "commander";
import { AppError } from "../../util/errors.js";

/**
 * `supermemory init [path]` — scaffolds `.memory/` (rules.md v1 defaults,
 * templates/, config.yml), default folders incl. top-level `conflicts/`,
 * vault `.gitignore` and `.gitattributes`, then validates and commits.
 * The full implementation lands in task 1.17; this registration wires
 * the commander surface.
 */
export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description(
      "Scaffold .memory/ (rules, templates, config) in a new vault and make the initial commit.",
    )
    .argument("[path]", "vault path (default: current directory)")
    .action(async () => {
      throw new AppError(
        "BOOT_VALIDATION_FAILED",
        "`supermemory init` is not implemented in this slice yet (task 1.17).",
        { hint: "This build wires the CLI surface only." },
      );
    });
}
