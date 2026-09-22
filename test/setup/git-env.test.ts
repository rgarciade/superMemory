import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyHermeticGitConfigIsolation,
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

// Second remediation batch, N5 [RED first]: tests run from hooks (e.g.
// husky/pre-commit invoking `npm test`) may inherit GIT_DIR/
// GIT_INDEX_FILE/GIT_WORK_TREE pointing at the invoking repo, and git
// itself supports injecting config purely via
// GIT_CONFIG_COUNT/GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n/
// GIT_CONFIG_PARAMETERS — none of that is covered by
// GIT_CONFIG_GLOBAL/GIT_CONFIG_NOSYSTEM alone.
describe("buildHermeticGitConfigIsolation — clears hook-inherited/dynamic git env noise", () => {
  it("clears GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE", () => {
    const env = buildHermeticGitConfigIsolation({
      GIT_DIR: "/somewhere/.git",
      GIT_INDEX_FILE: "/somewhere/.git/index",
      GIT_WORK_TREE: "/somewhere",
    });
    expect(env["GIT_DIR"]).toBeUndefined();
    expect(env["GIT_INDEX_FILE"]).toBeUndefined();
    expect(env["GIT_WORK_TREE"]).toBeUndefined();
  });

  it("clears GIT_CONFIG_COUNT/GIT_CONFIG_KEY_*/GIT_CONFIG_VALUE_*/GIT_CONFIG_PARAMETERS", () => {
    const env = buildHermeticGitConfigIsolation({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_VALUE_0: "Injected",
      GIT_CONFIG_PARAMETERS: "'user.name=Injected'",
    });
    expect(env["GIT_CONFIG_COUNT"]).toBeUndefined();
    expect(env["GIT_CONFIG_KEY_0"]).toBeUndefined();
    expect(env["GIT_CONFIG_VALUE_0"]).toBeUndefined();
    expect(env["GIT_CONFIG_PARAMETERS"]).toBeUndefined();
  });

  it("a poisoned GIT_DIR/GIT_WORK_TREE (as a git hook would inherit) no longer redirects git into the wrong repo", async () => {
    const decoyRepo = await mkdtemp(path.join(os.tmpdir(), "sm-decoy-repo-"));
    const realRepo = await mkdtemp(path.join(os.tmpdir(), "sm-real-repo-"));
    try {
      await execFileAsync("git", ["init"], {
        cwd: decoyRepo,
        env: buildHermeticGitConfigIsolation({ PATH: process.env["PATH"] }),
      });
      await execFileAsync("git", ["init"], {
        cwd: realRepo,
        env: buildHermeticGitConfigIsolation({ PATH: process.env["PATH"] }),
      });

      const poisonedBase = {
        PATH: process.env["PATH"],
        GIT_DIR: path.join(decoyRepo, ".git"),
        GIT_WORK_TREE: decoyRepo,
      };
      const env = buildHermeticGitConfigIsolation(poisonedBase);
      const { stdout } = await execFileAsync(
        "git",
        ["rev-parse", "--show-toplevel"],
        { cwd: realRepo, env },
      );
      expect(stdout.trim()).toBe(await realpath(realRepo));
    } finally {
      await rm(decoyRepo, { recursive: true, force: true });
      await rm(realRepo, { recursive: true, force: true });
    }
  });
});

describe("applyHermeticGitConfigIsolation — mutates the target in place (Object.assign cannot delete keys)", () => {
  it("actually deletes a pre-existing GIT_DIR from the target object, not just omits it from a returned copy", () => {
    const target: NodeJS.ProcessEnv = { GIT_DIR: "/somewhere/.git" };
    applyHermeticGitConfigIsolation(target);
    expect(target["GIT_DIR"]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(target, "GIT_DIR")).toBe(false);
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
