import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { AppError } from "../../../src/util/errors.js";
import { initVault, commitInitScaffold } from "../../../src/cli/commands/init.js";
import { validateBoot, appRepoRoot } from "../../../src/boot/validate-boot.js";
import { parseRules } from "../../../src/rules/parser.js";
import {
  createTestVault,
  FIXTURE_VAULT_DIR,
} from "../../helpers/create-test-vault.js";
import type { SimpleGit } from "simple-git";

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

// Finding #1 [RED first]: run all guards BEFORE writing anything; never
// clobber existing vault-level git files; stage ONLY the scaffold
// paths, never `git add .`.
describe("initVault — guards run before any write", () => {
  it("refuses a vault path inside the app source repo WITHOUT writing any scaffold file", async () => {
    const appRepoRootPath = appRepoRoot();
    const inside = await mkdtemp(
      path.join(appRepoRootPath, "tmp-sm-guard-order-"),
    );
    try {
      const git = simpleGit(inside);
      await git.init();
      await git.addConfig("user.name", "Test User");
      await git.addConfig("user.email", "test@example.com");
      await git.addConfig("commit.gpgsign", "false");

      await expect(initVault(inside)).rejects.toBeInstanceOf(AppError);
      // The "not inside the app repo" guard must run before any write —
      // .memory/ must never have been created.
      expect(existsSync(path.join(inside, ".memory"))).toBe(false);
    } finally {
      await rm(inside, { recursive: true, force: true });
    }
  });
});

describe("initVault — never clobbers existing vault-level git files", () => {
  it("merges missing lines into an existing .gitignore instead of overwriting it", async () => {
    const root = await freshGitRepo("gitignore-merge");
    try {
      const preexisting = "node_modules/\n.env\n";
      await writeFile(path.join(root, ".gitignore"), preexisting, "utf8");
      await initVault(root);
      const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
      // both the pre-existing entries and the required scaffold entry
      // must be present — neither side clobbers the other.
      expect(gitignore).toContain("node_modules/");
      expect(gitignore).toContain(".env");
      expect(gitignore).toContain(".memory/cache/");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("merges missing lines into an existing .gitattributes instead of overwriting it", async () => {
    const root = await freshGitRepo("gitattributes-merge");
    try {
      const preexisting = "*.png binary\n";
      await writeFile(path.join(root, ".gitattributes"), preexisting, "utf8");
      await initVault(root);
      const gitattributes = await readFile(
        path.join(root, ".gitattributes"),
        "utf8",
      );
      expect(gitattributes).toContain("*.png binary");
      expect(gitattributes).toContain("merge=union");
      expect(gitattributes).toContain("merge=ours");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("initVault — stages only the scaffold paths", () => {
  it("does not commit unrelated untracked files sitting in the vault (never `git add .`)", async () => {
    const root = await freshGitRepo("stage-only-scaffold");
    try {
      await writeFile(path.join(root, ".env"), "SECRET=shh\n", "utf8");
      await writeFile(path.join(root, "draft.md"), "unrelated draft\n", "utf8");

      await initVault(root);

      const git = simpleGit(root);
      const status = await git.status();
      // Both files stay untracked — init must never have staged them.
      expect(status.not_added).toContain(".env");
      expect(status.not_added).toContain("draft.md");
      const log = await git.log();
      expect(log.latest?.message).not.toMatch(/env|draft/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// Findings #4/#5 [RED first]: a failed initial commit rolls back the
// scaffold (so a re-run resumes instead of refusing) and surfaces the
// real cause instead of always blaming git identity; `committed: true`
// must reflect an actual commit, not a resolved-but-empty one.
describe("initVault — commit failure recovery", () => {
  it("rolls back the scaffold and surfaces the real cause when the initial commit is rejected", async () => {
    const root = await freshGitRepo("commit-fail-rollback");
    try {
      await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
      const hookPath = path.join(root, ".git", "hooks", "pre-commit");
      await writeFile(
        hookPath,
        "#!/bin/sh\necho 'blocked-by-policy-hook' >&2\nexit 1\n",
        "utf8",
      );
      await chmod(hookPath, 0o755);

      let thrown: AppError | undefined;
      try {
        await initVault(root);
        expect.unreachable("must throw");
      } catch (err) {
        thrown = err as AppError;
      }
      expect(thrown).toBeInstanceOf(AppError);
      // the real cause must be surfaced, not just a blanket git-identity guess
      expect(thrown?.message).toContain("blocked-by-policy-hook");
      // rolled back: a re-run must not be refused by "rules.md already exists"
      expect(existsSync(path.join(root, ".memory", "rules.md"))).toBe(false);

      // remove the blocking hook and confirm the re-run resumes cleanly
      await rm(hookPath, { force: true });
      const result = await initVault(root);
      expect(result.committed).toBe(true);
      const boot = await validateBoot(root);
      expect(boot.ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("commitInitScaffold", () => {
  it("throws when git resolves the commit with no commit hash (nothing actually committed)", async () => {
    const fakeGit = {
      add: async () => undefined,
      commit: async () => ({
        author: null,
        branch: "",
        commit: "",
        root: false,
        summary: { changes: 0, insertions: 0, deletions: 0 },
      }),
    } as unknown as SimpleGit;

    await expect(
      commitInitScaffold(fakeGit, ["a", "b"], "chore: test"),
    ).rejects.toThrow(/no commit/i);
  });

  it("succeeds when git resolves the commit with a real commit hash", async () => {
    const fakeGit = {
      add: async () => undefined,
      commit: async () => ({
        author: null,
        branch: "main",
        commit: "abc1234",
        root: true,
        summary: { changes: 1, insertions: 1, deletions: 0 },
      }),
    } as unknown as SimpleGit;

    await expect(
      commitInitScaffold(fakeGit, ["a"], "chore: test"),
    ).resolves.toBeUndefined();
  });
});
