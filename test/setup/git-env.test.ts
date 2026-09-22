import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyHermeticGitEnv,
  buildHermeticGitConfigIsolation,
  buildHermeticGitEnv,
} from "./git-env.js";

// Finding #8 [RED first]: test git must never depend on the developer's
// own ~/.gitconfig (hooks path, gpgsign, aliases) or real shell
// identity. Every child `git` process spawned by simple-git or
// execFile inherits process.env, so isolating it at the env level fixes
// the reported CI failure mode (`user.useConfigOnly=true`, no local
// identity) without disturbing tests that configure their own LOCAL
// git identity (env-level identity would win over local config and
// silently break those tests' author-name assertions).

const execFileAsync = promisify(execFile);

describe("buildHermeticGitConfigIsolation", () => {
  it("points git away from the developer's global/system config only", () => {
    const env = buildHermeticGitConfigIsolation({});
    expect(env["GIT_CONFIG_GLOBAL"]).toBe("/dev/null");
    expect(env["GIT_CONFIG_NOSYSTEM"]).toBe("1");
    // Must NOT force an author/committer identity — that would always
    // win over a repo's local `user.name`/`user.email` config.
    expect(env["GIT_AUTHOR_NAME"]).toBeUndefined();
    expect(env["GIT_AUTHOR_EMAIL"]).toBeUndefined();
  });

  it("never overrides a repo's local git identity (config isolation is safe to apply globally)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sm-git-local-id-"));
    const env = buildHermeticGitConfigIsolation({ PATH: process.env["PATH"] });
    try {
      await execFileAsync("git", ["init"], { cwd: dir, env });
      await execFileAsync(
        "git",
        ["config", "user.name", "Local Identity"],
        { cwd: dir, env },
      );
      await execFileAsync(
        "git",
        ["config", "user.email", "local@example.com"],
        { cwd: dir, env },
      );
      await execFileAsync(
        "git",
        ["commit", "--allow-empty", "-m", "test"],
        { cwd: dir, env },
      );
      const { stdout } = await execFileAsync(
        "git",
        ["log", "-1", "--format=%an <%ae>"],
        { cwd: dir, env },
      );
      expect(stdout.trim()).toBe("Local Identity <local@example.com>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildHermeticGitEnv", () => {
  it("supplies a fixed fallback author/committer identity on top of config isolation", () => {
    const env = buildHermeticGitEnv({});
    expect(env["GIT_CONFIG_GLOBAL"]).toBe("/dev/null");
    expect(env["GIT_CONFIG_NOSYSTEM"]).toBe("1");
    expect(env["GIT_AUTHOR_NAME"]).toBeTruthy();
    expect(env["GIT_AUTHOR_EMAIL"]).toBeTruthy();
    expect(env["GIT_COMMITTER_NAME"]).toBeTruthy();
    expect(env["GIT_COMMITTER_EMAIL"]).toBeTruthy();
  });

  it("preserves the rest of the base env (e.g. PATH so `git` resolves)", () => {
    const env = buildHermeticGitEnv({ PATH: "/usr/bin", CUSTOM: "kept" });
    expect(env["PATH"]).toBe("/usr/bin");
    expect(env["CUSTOM"]).toBe("kept");
  });
});

describe("applyHermeticGitEnv", () => {
  it("a commit succeeds with no local identity and user.useConfigOnly=true (the reported CI failure mode)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sm-git-identity-"));
    const env = applyHermeticGitEnv({ PATH: process.env["PATH"] });
    try {
      await execFileAsync("git", ["init"], { cwd: dir, env });
      await execFileAsync(
        "git",
        ["config", "user.useConfigOnly", "true"],
        { cwd: dir, env },
      );
      const { stdout } = await execFileAsync(
        "git",
        ["commit", "--allow-empty", "-m", "test"],
        { cwd: dir, env },
      );
      expect(stdout).toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
