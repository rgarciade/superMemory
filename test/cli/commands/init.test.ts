import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { AppError } from "../../../src/util/errors.js";
import { initVault } from "../../../src/cli/commands/init.js";
import { validateBoot } from "../../../src/boot/validate-boot.js";
import { parseRules } from "../../../src/rules/parser.js";
import {
  createTestVault,
  FIXTURE_VAULT_DIR,
} from "../../helpers/create-test-vault.js";

// Task 1.17 [RED first]: init scaffolds .memory/ (rules v1 + git tunable
// seed, templates, config.yml), folders incl. top-level conflicts/,
// vault .gitignore + .gitattributes, then validateBoot + initial commit.

/** A fresh empty git repo in tmp with local identity (an un-onboarded vault). */
async function freshGitRepo(name: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `sm-init-${name}-`));
  const git = simpleGit(root);
  await git.init();
  await git.addConfig("user.name", "Test User");
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("commit.gpgsign", "false");
  return root;
}

const FOLDERS = [
  "specs",
  "decisions",
  "incidents",
  "learnings",
  "facts",
  "logs",
  "index",
  "conflicts",
];

describe("initVault — scaffold", () => {
  it("writes .memory/, templates, config.yml, folders, gitignore, gitattributes", async () => {
    const root = await freshGitRepo("scaffold");
    try {
      await initVault(root);
      expect(existsSync(path.join(root, ".memory", "rules.md"))).toBe(true);
      expect(existsSync(path.join(root, ".memory", "config.yml"))).toBe(true);
      for (const t of [
        "decision",
        "spec",
        "incident",
        "session-log",
        "agent-instructions",
      ]) {
        expect(existsSync(path.join(root, ".memory", "templates", `${t}.md`))).toBe(
          true,
        );
      }
      for (const folder of FOLDERS) {
        expect(existsSync(path.join(root, folder))).toBe(true);
      }
      const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
      expect(gitignore).toContain(".memory/cache/");
      const gitattributes = await readFile(
        path.join(root, ".gitattributes"),
        "utf8",
      );
      expect(gitattributes).toContain("merge=union");
      expect(gitattributes).toContain("merge=ours");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rules parse cleanly and carry the git tunable seed (15/45)", async () => {
    const root = await freshGitRepo("rules");
    try {
      await initVault(root);
      const rules = parseRules(
        await readFile(path.join(root, ".memory", "rules.md"), "utf8"),
      );
      expect(rules.formatVersion).toBe("1.0");
      expect(rules.git.syncIntervalMinutes).toBe(15);
      expect(rules.git.debounceSeconds).toBe(45);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scaffold matches the committed test fixture (drift pin)", async () => {
    const root = await freshGitRepo("drift");
    try {
      await initVault(root);
      for (const rel of [
        ".memory/rules.md",
        ".memory/config.yml",
        ".gitattributes",
        ".memory/templates/decision.md",
        ".memory/templates/spec.md",
        ".memory/templates/incident.md",
        ".memory/templates/session-log.md",
        ".memory/templates/agent-instructions.md",
      ]) {
        const fromInit = await readFile(path.join(root, rel), "utf8");
        const fromFixture = await readFile(path.join(FIXTURE_VAULT_DIR, rel), "utf8");
        expect(fromInit, rel).toBe(fromFixture);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("initVault — validate + commit", () => {
  it("boot-validates the fresh vault and makes exactly one initial commit", async () => {
    const root = await freshGitRepo("commit");
    try {
      const result = await initVault(root);
      expect(result.committed).toBe(true);

      const boot = await validateBoot(root);
      expect(boot.ok).toBe(true);

      const git = simpleGit(root);
      const log = await git.log();
      expect(log.total).toBe(1);
      expect(log.latest?.message).toContain("initialize");
      const status = await git.status();
      expect(status.isClean()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to re-init a vault that already has .memory/rules.md", async () => {
    const root = await freshGitRepo("reinit");
    try {
      await initVault(root);
      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a directory that is not a git repo, hinting git init", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sm-init-nogit-"));
    try {
      try {
        await initVault(root);
        expect.unreachable("must throw");
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe("BOOT_VALIDATION_FAILED");
        expect(appErr.hint ?? "").toContain("git init");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a nonexistent path", async () => {
    await expect(initVault("/nonexistent/vault")).rejects.toBeInstanceOf(AppError);
  });
});

describe("initVault — equivalence with the fixture fixture", () => {
  it("a vault made by init boot-validates like the fixture vault", async () => {
    const root = await freshGitRepo("equiv");
    const fixture = await createTestVault();
    try {
      await initVault(root);
      const bootInit = await validateBoot(root);
      const bootFixture = await validateBoot(fixture.root);
      expect(bootInit.ok).toBe(bootFixture.ok);
    } finally {
      await rm(root, { recursive: true, force: true });
      await fixture.cleanup();
    }
  });
});
