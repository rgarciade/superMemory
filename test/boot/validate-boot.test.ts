import { describe, expect, it } from "vitest";
import { mkdir, rm, writeFile, readFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateBoot, appRepoRoot } from "../../src/boot/validate-boot.js";
import { AppError } from "../../src/util/errors.js";
import { createTestVault } from "../helpers/create-test-vault.js";

// Task 1.15 [RED first]: five ordered fail-fast boot checks
// (boot-validation spec): exists, git repo, rules.md present, not inside
// the app repo, format_version supported. One negative fixture per check.

// The supermemory app source root, from the same detection the check uses.
const appRepoRootPath = appRepoRoot();

async function expectBootFailure(
  vaultPath: string,
): Promise<AppError> {
  try {
    await validateBoot(vaultPath);
    expect.unreachable("must throw");
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
}

describe("validateBoot — valid vault", () => {
  it("passes all five checks", async () => {
    const vault = await createTestVault();
    try {
      const result = await validateBoot(vault.root);
      expect(result.ok).toBe(true);
    } finally {
      await vault.cleanup();
    }
  });
});

describe("validateBoot — one negative fixture per check", () => {
  it("check 1: nonexistent directory aborts with an actionable error", async () => {
    const err = await expectBootFailure("/nonexistent/supermemory/vault");
    expect(err.code).toBe("BOOT_VALIDATION_FAILED");
    expect(err.message).toMatch(/directory/i);
    expect(err.message).toContain("/nonexistent/supermemory/vault");
    expect(err.hint).toBeTruthy();
  });

  it("check 2: existing directory that is not a git repo aborts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sm-nogit-"));
    try {
      const err = await expectBootFailure(dir);
      expect(err.code).toBe("BOOT_VALIDATION_FAILED");
      expect(err.message).toMatch(/git/i);
      expect(err.hint).toContain("git init");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("check 3: git repo without .memory/rules.md points at vault init", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sm-norules-"));
    try {
      await mkdir(path.join(dir, ".memory"), { recursive: true });
      const { simpleGit } = await import("simple-git");
      await simpleGit(dir).init();
      const err = await expectBootFailure(dir);
      expect(err.code).toBe("BOOT_VALIDATION_FAILED");
      expect(err.message).toContain(".memory/rules.md");
      expect(err.hint).toContain("supermemory init");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("check 4: a vault inside the app source repo aborts (private notes guard)", async () => {
    // Checks run in order, so the inside-app path must first pass
    // exists/git/rules — build an ephemeral mini-vault inside the app repo.
    const inside = await mkdtemp(path.join(appRepoRootPath, "tmp-sm-inside-"));
    try {
      await mkdir(path.join(inside, ".memory"), { recursive: true });
      await writeFile(
        path.join(inside, ".memory", "rules.md"),
        "---\nformat_version: 1.0\n---\n",
        "utf8",
      );
      const { simpleGit } = await import("simple-git");
      await simpleGit(inside).init();
      const err = await expectBootFailure(inside);
      expect(err.code).toBe("BOOT_VALIDATION_FAILED");
      expect(err.message).toMatch(/inside the supermemory/i);
    } finally {
      await rm(inside, { recursive: true, force: true });
    }
  });

  it("check 5: unsupported format_version aborts via the version contract", async () => {
    const vault = await createTestVault();
    try {
      const rules = await readFile(vault.paths.rulesPath, "utf8");
      await writeFile(
        vault.paths.rulesPath,
        rules.replace("format_version: 1.0", "format_version: 2.0"),
        "utf8",
      );
      const err = await expectBootFailure(vault.root);
      expect(err.code).toBe("FORMAT_VERSION_UNSUPPORTED");
      expect(err.message).toContain("format 2.x");
    } finally {
      await vault.cleanup();
    }
  });
});

describe("validateBoot — ordering", () => {
  it("check failures are reported for the first failing check only", async () => {
    // A nonexistent path also lacks .git and rules.md, but the error is
    // about the directory (check 1), not later checks.
    const err = await expectBootFailure("/nonexistent/other");
    expect(err.message).toMatch(/directory/i);
    expect(err.message).not.toMatch(/rules\.md/);
  });
});
