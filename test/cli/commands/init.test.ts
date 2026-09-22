import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { simpleGit } from "simple-git";
import { AppError } from "../../../src/util/errors.js";
import {
  initVault,
  commitInitScaffold,
  newScaffoldTracker,
  rollbackScaffold,
} from "../../../src/cli/commands/init.js";
import { validateBoot, appRepoRoot } from "../../../src/boot/validate-boot.js";
import { parseRules } from "../../../src/rules/parser.js";
import {
  createTestVault,
  FIXTURE_VAULT_DIR,
} from "../../helpers/create-test-vault.js";
import type { SimpleGit } from "simple-git";

const execFileAsync = promisify(execFile);

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

  // N7 [RED first]: preserve the file's own line ending; a later
  // negation (`!line`) must not count as the line being present.
  it("preserves an existing CRLF .gitignore's line ending for the appended lines", async () => {
    const root = await freshGitRepo("gitignore-crlf");
    try {
      const preexisting = "node_modules/\r\n.env\r\n";
      await writeFile(path.join(root, ".gitignore"), preexisting, "utf8");
      await initVault(root);
      const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
      expect(gitignore.startsWith(preexisting)).toBe(true);
      expect(gitignore).toContain(".memory/cache/\r\n");
      // no bare LF was introduced into the appended section
      const appended = gitignore.slice(preexisting.length);
      expect(appended.includes("\n") && !appended.includes("\r\n")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("re-appends a line whose only prior occurrence was negated (gitignore last-match-wins)", async () => {
    const root = await freshGitRepo("gitignore-negated");
    try {
      // the file already un-ignores .memory/cache/ via a later `!` line
      // — the positive entry is NOT in effect, so init must add it
      // again (appending, not skipping) to actually ignore it.
      const preexisting = ".memory/cache/\n!.memory/cache/\n";
      await writeFile(path.join(root, ".gitignore"), preexisting, "utf8");
      await initVault(root);
      const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
      const lines = gitignore.split("\n").map((l) => l.trim()).filter(Boolean);
      const lastMemoryCacheLine = [...lines]
        .reverse()
        .find((l) => l === ".memory/cache/" || l === "!.memory/cache/");
      expect(lastMemoryCacheLine).toBe(".memory/cache/");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does NOT re-append a line whose last occurrence is already positive (idempotent merge)", async () => {
    const root = await freshGitRepo("gitignore-idempotent");
    try {
      // negated, then re-affirmed — the positive form IS in effect, so
      // nothing should be appended for this line.
      const preexisting = "!.memory/cache/\n.memory/cache/\n";
      await writeFile(path.join(root, ".gitignore"), preexisting, "utf8");
      await initVault(root);
      const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
      const occurrences = gitignore
        .split("\n")
        .filter((l) => l.trim() === ".memory/cache/").length;
      expect(occurrences).toBe(1);
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

// Second remediation batch, N1 CRITICAL [RED first]: rollback must ONLY
// undo what THIS run created — pre-existing `.memory/` content (a
// vault that already has a `.memory/` dir, just not `rules.md` yet)
// must survive a failed commit untouched.
describe("initVault — rollback never deletes pre-existing content", () => {
  it("pre-existing .memory/ files and a custom templates/spec.md survive a rolled-back commit", async () => {
    const root = await freshGitRepo("rollback-no-data-loss");
    try {
      await mkdir(path.join(root, ".memory", "templates"), { recursive: true });
      await writeFile(
        path.join(root, ".memory", "notes.txt"),
        "precious notes\n",
        "utf8",
      );
      await writeFile(
        path.join(root, ".memory", "local.json"),
        '{"local":true}',
        "utf8",
      );
      await writeFile(
        path.join(root, ".memory", "config.yml"),
        "# custom pre-existing config\n",
        "utf8",
      );
      await writeFile(
        path.join(root, ".memory", "templates", "spec.md"),
        "custom spec template\n",
        "utf8",
      );

      await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
      const hookPath = path.join(root, ".git", "hooks", "pre-commit");
      await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8");
      await chmod(hookPath, 0o755);

      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);

      expect(
        await readFile(path.join(root, ".memory", "notes.txt"), "utf8"),
      ).toBe("precious notes\n");
      expect(
        await readFile(path.join(root, ".memory", "local.json"), "utf8"),
      ).toBe('{"local":true}');
      expect(
        await readFile(path.join(root, ".memory", "config.yml"), "utf8"),
      ).toBe("# custom pre-existing config\n");
      expect(
        await readFile(
          path.join(root, ".memory", "templates", "spec.md"),
          "utf8",
        ),
      ).toBe("custom spec template\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores the original bytes of a pre-existing .gitignore/.gitattributes instead of deleting them", async () => {
    const root = await freshGitRepo("rollback-restore-git-files");
    try {
      const originalGitignore = "node_modules/\n.env\n";
      const originalGitattributes = "*.png binary\n";
      await writeFile(path.join(root, ".gitignore"), originalGitignore, "utf8");
      await writeFile(
        path.join(root, ".gitattributes"),
        originalGitattributes,
        "utf8",
      );

      await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
      const hookPath = path.join(root, ".git", "hooks", "pre-commit");
      await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8");
      await chmod(hookPath, 0o755);

      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);

      expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(
        originalGitignore,
      );
      expect(await readFile(path.join(root, ".gitattributes"), "utf8")).toBe(
        originalGitattributes,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fully created-and-rolled-back scaffold leaves no trace: .memory/, folders, and vault git files are all gone, index is unstaged", async () => {
    const root = await freshGitRepo("rollback-full-trace");
    try {
      await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
      const hookPath = path.join(root, ".git", "hooks", "pre-commit");
      await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8");
      await chmod(hookPath, 0o755);

      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);

      expect(existsSync(path.join(root, ".memory"))).toBe(false);
      expect(existsSync(path.join(root, ".gitignore"))).toBe(false);
      expect(existsSync(path.join(root, ".gitattributes"))).toBe(false);
      for (const folder of FOLDERS) {
        // every default folder was created fresh by this run and its
        // only content (.gitkeep) was rolled back too — deepest-first,
        // only-if-empty pruning removes the now-empty folder.
        expect(existsSync(path.join(root, folder))).toBe(false);
      }

      const git = simpleGit(root);
      const status = await git.status();
      expect(status.staged).toEqual([]);
      expect(status.isClean()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// N4 [RED first]: the "scaffold was rolled back" hint must be truthful
// — no lingering staged paths, no lingering files.
describe("initVault — rollback hint is truthful", () => {
  it("the failure hint does not claim a rollback happened without actually leaving a clean tree", async () => {
    const root = await freshGitRepo("rollback-hint-truthful");
    try {
      await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
      const hookPath = path.join(root, ".git", "hooks", "pre-commit");
      await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8");
      await chmod(hookPath, 0o755);

      let thrown: AppError | undefined;
      try {
        await initVault(root);
        expect.unreachable("must throw");
      } catch (err) {
        thrown = err as AppError;
      }
      expect(thrown?.hint).toBeTruthy();

      const git = simpleGit(root);
      const status = await git.status();
      expect(status.isClean()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// #4 PARTIAL [RED first]: a write failure BEFORE the commit try block
// (e.g. EACCES writing into a pre-existing read-only folder) must also
// roll back, so a re-run is not refused by "rules.md already exists".
describe("initVault — rolls back a write failure before the commit phase", () => {
  it("EACCES writing .gitkeep into a read-only pre-existing folder rolls back rules.md too", async () => {
    const root = await freshGitRepo("write-failure-rollback");
    const specsDir = path.join(root, "specs");
    await mkdir(specsDir, { recursive: true });
    await chmod(specsDir, 0o500); // read + execute only, no write
    try {
      let thrown: unknown;
      try {
        await initVault(root);
        expect.unreachable("must throw");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe("BOOT_VALIDATION_FAILED");

      // rolled back: rules.md must not be left behind blocking a re-run
      expect(existsSync(path.join(root, ".memory", "rules.md"))).toBe(false);
    } finally {
      await chmod(specsDir, 0o700);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a re-run succeeds once the permission problem is fixed", async () => {
    const root = await freshGitRepo("write-failure-resume");
    const specsDir = path.join(root, "specs");
    await mkdir(specsDir, { recursive: true });
    await chmod(specsDir, 0o500);
    try {
      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);
      await chmod(specsDir, 0o700);
      const result = await initVault(root);
      expect(result.committed).toBe(true);
      const boot = await validateBoot(root);
      expect(boot.ok).toBe(true);
    } finally {
      await chmod(specsDir, 0o700);
      await rm(root, { recursive: true, force: true });
    }
  });
});

// N2 [RED first]: the initial commit must never sweep in files the user
// had already staged before running init.
describe("initVault — commits only the scaffold, ignoring pre-staged changes", () => {
  it("does not include a pre-staged unrelated file in the init commit", async () => {
    const root = await freshGitRepo("preexisting-stage");
    try {
      await writeFile(path.join(root, "secret.env"), "TOKEN=abc\n", "utf8");
      const git = simpleGit(root);
      await git.add(["secret.env"]);

      const result = await initVault(root);
      expect(result.committed).toBe(true);

      const stat = await git.raw(["show", "--stat", "--format=", "HEAD"]);
      expect(stat).not.toContain("secret.env");

      // the user's staged file is left exactly as they staged it —
      // neither committed nor discarded.
      const status = await git.status();
      expect(status.staged).toContain("secret.env");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("commitInitScaffold", () => {
  it("throws when git resolves the commit with no commit hash (nothing actually committed)", async () => {
    const fakeGit = {
      raw: async () => "",
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
      raw: async () => "",
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

  it("stages with -f (a scaffold path can be matched by core.excludesFile)", async () => {
    const rawCalls: string[][] = [];
    const fakeGit = {
      raw: async (args: string[]) => {
        rawCalls.push(args);
        return "";
      },
      commit: async () => ({
        author: null,
        branch: "main",
        commit: "abc1234",
        root: true,
        summary: { changes: 1, insertions: 1, deletions: 0 },
      }),
    } as unknown as SimpleGit;

    await commitInitScaffold(fakeGit, ["a", "b"], "chore: test");

    expect(rawCalls).toContainEqual(["add", "-f", "--", "a", "b"]);
  });
});

// Third remediation batch, W1 [RED first]: a path is only registered in
// the tracker AFTER its write succeeds, so a write that fails
// mid-file (EFBIG under `ulimit -f`, ENOSPC, a quota) leaves a
// truncated file the rollback doesn't know about — every re-run is
// then refused ("already has rules.md"). Real, OS-level repro: spawn a
// real `initVault` run (via tsx, so no build step is required) under a
// shell-level file-size rlimit small enough that writing rules.md
// (2.2 KB) overflows it.
describe("initVault — a write failure mid-file does not leave an untracked truncated file", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
  const initModuleUrl = pathToFileURL(
    path.join(repoRoot, "src", "cli", "commands", "init.ts"),
  ).href;

  async function writeHarness(dir: string): Promise<string> {
    const harnessPath = path.join(dir, "harness.mjs");
    const script = [
      `const { initVault } = await import(${JSON.stringify(initModuleUrl)});`,
      "const vaultPath = process.argv[2];",
      "try {",
      "  const result = await initVault(vaultPath);",
      '  process.stdout.write("OK " + JSON.stringify(result));',
      "} catch (err) {",
      '  process.stdout.write("ERR " + (err && err.code ? err.code : "") + " " + (err && err.message ? err.message : String(err)));',
      "}",
    ].join("\n");
    await writeFile(harnessPath, script, "utf8");
    return harnessPath;
  }

  it("a write cut short by a file-size limit (EFBIG) is rolled back, and a re-run succeeds", async () => {
    const root = await freshGitRepo("efbig");
    const harnessDir = await mkdtemp(path.join(os.tmpdir(), "sm-efbig-harness-"));
    try {
      const harnessPath = await writeHarness(harnessDir);
      // RULES_MD is ~2.2 KB; `ulimit -f 2` caps writes well under that,
      // so the write into rules.md fails partway through with EFBIG.
      const { stdout } = await execFileAsync("sh", [
        "-c",
        `ulimit -f 2 && exec "${tsxBin}" "${harnessPath}" "${root}"`,
      ]);
      expect(stdout).toContain("ERR");
      expect(stdout).toContain("EFBIG");

      // the truncated file must not survive: the tracker must have
      // known about it BEFORE the write, so rollback can remove it.
      expect(existsSync(path.join(root, ".memory", "rules.md"))).toBe(false);
      expect(existsSync(path.join(root, ".memory"))).toBe(false);

      // a re-run (no rlimit this time) must succeed — nothing left
      // behind to trip check 3 ("already has rules.md").
      const result = await initVault(root);
      expect(result.committed).toBe(true);
      const boot = await validateBoot(root);
      expect(boot.ok).toBe(true);
    } finally {
      await rm(harnessDir, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);
});

// Third remediation batch, W2 [RED first]: rollback unstaged scaffold
// paths via `git reset -- <paths>`, which resets the INDEX to HEAD —
// not to whatever the user had staged before running init. If
// `.gitignore` was already staged with content that differs from both
// HEAD and the working tree, that staged version is silently lost.
// Reproduced both with and without a HEAD (an unborn branch has no ref
// to reset to at all — `git reset -- path` there fully drops the
// user's staged entry instead of restoring it).
describe("initVault — rollback restores the exact index entry the user had staged", () => {
  it("with a HEAD: a staged .gitignore differing from both HEAD and the merged content is restored exactly", async () => {
    const root = await freshGitRepo("index-restore-head");
    try {
      const git = simpleGit(root);
      await writeFile(path.join(root, ".gitignore"), "content-v1\n", "utf8");
      await git.add([".gitignore"]);
      await git.raw(["commit", "-m", "initial"]);

      // the user stages a DIFFERENT version than HEAD, then runs init
      await writeFile(path.join(root, ".gitignore"), "user-staged-version\n", "utf8");
      await git.add([".gitignore"]);
      const beforeInit = (await git.raw(["show", ":.gitignore"])).trim();
      expect(beforeInit).toBe("user-staged-version");

      await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
      const hookPath = path.join(root, ".git", "hooks", "pre-commit");
      await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8");
      await chmod(hookPath, 0o755);

      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);

      const afterRollback = (await git.raw(["show", ":.gitignore"])).trim();
      // must be the user's staged content — NOT HEAD's "content-v1"
      // (what a bare `git reset -- path` would restore) and NOT the
      // merged content init staged before failing.
      expect(afterRollback).toBe("user-staged-version");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("without a HEAD (unborn branch): a staged .gitignore survives a rolled-back init", async () => {
    const root = await freshGitRepo("index-restore-no-head");
    try {
      const git = simpleGit(root);
      await writeFile(path.join(root, ".gitignore"), "user-staged-no-head\n", "utf8");
      await git.add([".gitignore"]);
      const beforeInit = (await git.raw(["show", ":.gitignore"])).trim();
      expect(beforeInit).toBe("user-staged-no-head");

      await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
      const hookPath = path.join(root, ".git", "hooks", "pre-commit");
      await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8");
      await chmod(hookPath, 0o755);

      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);

      const afterRollback = (await git.raw(["show", ":.gitignore"])).trim();
      expect(afterRollback).toBe("user-staged-no-head");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a scaffold path the user had NOT staged before init is unstaged again after rollback (not left committed to a stale blob)", async () => {
    const root = await freshGitRepo("index-restore-new-path");
    try {
      await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
      const hookPath = path.join(root, ".git", "hooks", "pre-commit");
      await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8");
      await chmod(hookPath, 0o755);

      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);

      const git = simpleGit(root);
      const status = await git.status();
      expect(status.staged).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// Third remediation batch, W3 [RED first]: mergeMissingLines and the
// rollback restore path read/wrote merged files as UTF-8 TEXT. A raw
// non-UTF8 byte (e.g. Latin-1 0xE9, "é") is not valid UTF-8 on its
// own, so decoding-then-reencoding it turns it into the UTF-8
// replacement sequence EF BF BD — corrupting the byte permanently, on
// BOTH the success path (what gets committed) and the rollback path
// (what gets "restored").
describe("initVault — merges and restores raw bytes, never re-encodes them", () => {
  const LATIN1_BYTE = 0xe9; // 'é' in Latin-1 — not valid standalone UTF-8
  const REPLACEMENT_CHAR_UTF8 = Buffer.from([0xef, 0xbf, 0xbd]);

  function buildLatin1Gitignore(): Buffer {
    return Buffer.concat([
      Buffer.from("caf", "ascii"),
      Buffer.from([LATIN1_BYTE]),
      Buffer.from(".txt\n", "ascii"),
    ]);
  }

  it("a rolled-back merge restores the exact original bytes (no UTF-8 re-encoding)", async () => {
    const root = await freshGitRepo("bytes-rollback");
    try {
      const original = buildLatin1Gitignore();
      await writeFile(path.join(root, ".gitignore"), original);

      await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
      const hookPath = path.join(root, ".git", "hooks", "pre-commit");
      await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8");
      await chmod(hookPath, 0o755);

      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);

      const restored = await readFile(path.join(root, ".gitignore"));
      expect(restored.equals(original)).toBe(true);
      expect(restored.includes(REPLACEMENT_CHAR_UTF8)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a successful merge preserves the pre-existing bytes unchanged and only appends the missing lines", async () => {
    const root = await freshGitRepo("bytes-success");
    try {
      const original = buildLatin1Gitignore();
      await writeFile(path.join(root, ".gitignore"), original);

      const result = await initVault(root);
      expect(result.committed).toBe(true);

      const merged = await readFile(path.join(root, ".gitignore"));
      expect(merged.subarray(0, original.length).equals(original)).toBe(true);
      expect(merged.includes(REPLACEMENT_CHAR_UTF8)).toBe(false);
      // the appended scaffold entry is still present (real merge, not
      // just "leave it alone")
      expect(merged.includes(Buffer.from(".memory/cache/", "ascii"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// Third remediation batch, W4 [RED first]: existsSync/writeFile follow
// symlinks. A dangling `.memory/config.yml` symlink makes init write
// the config OUTSIDE the vault (through the link) instead of refusing;
// a symlinked `.gitignore` makes a successful run append to and commit
// whatever the link points at outside the vault (and commit the
// symlink itself, mode 120000). Refuse via `lstat` (never follows
// symlinks) BEFORE any write.
describe("initVault — refuses scaffold paths that are symlinks", () => {
  it("a dangling .memory/config.yml symlink is refused; nothing is created at the link target", async () => {
    const root = await freshGitRepo("symlink-config");
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "sm-symlink-outside-"));
    try {
      const outsideTarget = path.join(outsideDir, "config.yml");
      await mkdir(path.join(root, ".memory"), { recursive: true });
      await symlink(outsideTarget, path.join(root, ".memory", "config.yml"));

      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);

      // the link itself is untouched, and nothing was ever created at
      // the outside target it dangles toward.
      const linkStat = await lstat(path.join(root, ".memory", "config.yml"));
      expect(linkStat.isSymbolicLink()).toBe(true);
      expect(existsSync(outsideTarget)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("a symlinked .gitignore is refused; the outside target and the link are both left untouched", async () => {
    const root = await freshGitRepo("symlink-gitignore");
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "sm-symlink-outside2-"));
    try {
      const outsideTarget = path.join(outsideDir, "real-gitignore.txt");
      const outsideContent = "outside-content\n";
      await writeFile(outsideTarget, outsideContent, "utf8");
      await symlink(outsideTarget, path.join(root, ".gitignore"));

      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);

      const linkStat = await lstat(path.join(root, ".gitignore"));
      expect(linkStat.isSymbolicLink()).toBe(true);
      const outsideAfter = await readFile(outsideTarget, "utf8");
      expect(outsideAfter).toBe(outsideContent);

      // nothing was ever staged/committed (no symlink mode 120000
      // entry sneaking into the init commit either).
      const git = simpleGit(root);
      const status = await git.status();
      expect(status.staged).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("a symlinked default folder (e.g. specs/) is refused before anything is written into its target", async () => {
    const root = await freshGitRepo("symlink-folder");
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "sm-symlink-outside3-"));
    try {
      await symlink(outsideDir, path.join(root, "specs"));

      await expect(initVault(root)).rejects.toBeInstanceOf(AppError);

      const { readdir } = await import("node:fs/promises");
      expect(await readdir(outsideDir)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

// Third remediation batch, W5 [RED first]: `git add` without `-f`
// refuses (exit 1, not a silent skip) a path matched by
// `core.excludesFile` — with a global excludes file listing "logs",
// init always failed, since `logs` is one of the default folders.
// Reproduced with a LOCAL (never global) core.excludesFile on a
// disposable test repo, matching the same mechanism.
describe("initVault — stages the scaffold with -f (core.excludesFile can match a default folder)", () => {
  it("succeeds even when core.excludesFile matches one of the default folders", async () => {
    const root = await freshGitRepo("excludesfile");
    const excludesDir = await mkdtemp(path.join(os.tmpdir(), "sm-excludes-"));
    const excludesFile = path.join(excludesDir, "excludes.txt");
    try {
      await writeFile(excludesFile, "logs\n", "utf8");
      const git = simpleGit(root);
      await git.addConfig("core.excludesFile", excludesFile);

      const result = await initVault(root);
      expect(result.committed).toBe(true);

      const boot = await validateBoot(root);
      expect(boot.ok).toBe(true);
      const status = await git.status();
      expect(status.isClean()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(excludesDir, { recursive: true, force: true });
    }
  });
});

// Third remediation batch, S1 [RED first]: rollback errors were
// swallowed (bare `catch {}` / `.catch(() => undefined)`), yet the
// final hint unconditionally claimed "Everything this run created was
// removed". Rollback must collect what it could NOT undo and the
// caller must report it truthfully, keeping the ORIGINAL failure as
// the primary cause.
describe("rollbackScaffold — surfaces what it could not undo instead of swallowing it", () => {
  it("reports a created file it could not delete (EACCES on its parent dir)", async () => {
    const root = await freshGitRepo("rollback-report-file");
    const protectedDir = path.join(root, "protected");
    try {
      await mkdir(protectedDir);
      const stuckFile = path.join(protectedDir, "stuck.txt");
      await writeFile(stuckFile, "x", "utf8");
      await chmod(protectedDir, 0o500); // r-x: can't delete an entry inside it

      const tracker = newScaffoldTracker();
      tracker.createdFiles.push(stuckFile);

      const issues = await rollbackScaffold(root, tracker);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((issue) => issue.path === stuckFile)).toBe(true);
      // the file really is still there — rollback did NOT silently
      // "succeed" while actually leaving it behind.
      expect(existsSync(stuckFile)).toBe(true);
    } finally {
      await chmod(protectedDir, 0o700).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns no issues when everything was undone cleanly", async () => {
    const root = await freshGitRepo("rollback-report-clean");
    try {
      const file = path.join(root, "clean.txt");
      await writeFile(file, "x", "utf8");
      const tracker = newScaffoldTracker();
      tracker.createdFiles.push(file);

      const issues = await rollbackScaffold(root, tracker);

      expect(issues).toEqual([]);
      expect(existsSync(file)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("initVault — a rollback that cannot fully undo itself is reported truthfully", () => {
  it("a read-only .git (index restore genuinely fails) is listed in the failure, not hidden behind a false success claim", async () => {
    const root = await freshGitRepo("rollback-truthful-git");
    try {
      const git = simpleGit(root);
      await writeFile(path.join(root, ".gitignore"), "user-staged\n", "utf8");
      await git.add([".gitignore"]);

      await chmod(path.join(root, ".git"), 0o500);

      let thrown: AppError | undefined;
      try {
        await initVault(root);
        expect.unreachable("must throw");
      } catch (err) {
        thrown = err as AppError;
      } finally {
        await chmod(path.join(root, ".git"), 0o700);
      }

      expect(thrown).toBeInstanceOf(AppError);
      // truthful: must NOT claim a clean, complete rollback when the
      // index restore for .gitignore actually failed.
      const combined = `${thrown?.message ?? ""} ${thrown?.hint ?? ""}`;
      expect(combined).not.toContain(
        "Everything this run created was removed and anything it staged was unstaged",
      );
      expect(combined).toContain(".gitignore");
    } finally {
      await chmod(path.join(root, ".git"), 0o700).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});
