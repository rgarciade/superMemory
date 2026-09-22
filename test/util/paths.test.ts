import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  isInsideDir,
  isSameOrInsideDir,
  templatePathFor,
  vaultPaths,
} from "../../src/util/paths.js";

// Task 1.7 [RED first]: .memory layout helpers (design §1.2).
describe("vaultPaths", () => {
  it("derives the full .memory layout from the vault root", () => {
    const p = vaultPaths("/tmp/my-vault");
    expect(p.root).toBe("/tmp/my-vault");
    expect(p.memoryDir).toBe(path.join("/tmp/my-vault", ".memory"));
    expect(p.rulesPath).toBe(path.join("/tmp/my-vault", ".memory", "rules.md"));
    expect(p.templatesDir).toBe(
      path.join("/tmp/my-vault", ".memory", "templates"),
    );
    expect(p.configPath).toBe(
      path.join("/tmp/my-vault", ".memory", "config.yml"),
    );
    expect(p.localJsonPath).toBe(
      path.join("/tmp/my-vault", ".memory", "local.json"),
    );
    expect(p.cacheDir).toBe(
      path.join("/tmp/my-vault", ".memory", "cache"),
    );
    expect(p.conflictsDir).toBe(path.join("/tmp/my-vault", "conflicts"));
  });
});

describe("templatePathFor", () => {
  it("resolves a note type to its template file", () => {
    expect(templatePathFor("/tmp/v", "decision")).toBe(
      path.join("/tmp/v", ".memory", "templates", "decision.md"),
    );
  });
});

describe("isInsideDir", () => {
  it("detects nested paths", () => {
    expect(isInsideDir("/repo", "/repo/sub/vault")).toBe(true);
    expect(isInsideDir("/repo", "/repo/sub/vault/notes")).toBe(true);
  });

  it("the parent itself is not inside", () => {
    expect(isInsideDir("/repo", "/repo")).toBe(false);
  });

  it("siblings and unrelated paths are not inside", () => {
    expect(isInsideDir("/repo", "/repository")).toBe(false);
    expect(isInsideDir("/repo", "/other/place")).toBe(false);
  });
});

// Finding #1 [RED first]: isInsideDir(parent, child) returns false when
// paths are equal, which let validateBoot's "not inside the app repo"
// check pass for vaultPath === appRoot (e.g. `supermemory init` run
// from the app repo root, defaulting to "."). isSameOrInsideDir closes
// that gap without changing isInsideDir's own (correct) contract.
describe("isSameOrInsideDir", () => {
  it("the parent itself IS considered same-or-inside (closes the equality gap)", () => {
    expect(isSameOrInsideDir("/repo", "/repo")).toBe(true);
  });

  it("still detects nested paths", () => {
    expect(isSameOrInsideDir("/repo", "/repo/sub/vault")).toBe(true);
  });

  it("siblings and unrelated paths are not inside", () => {
    expect(isSameOrInsideDir("/repo", "/repository")).toBe(false);
    expect(isSameOrInsideDir("/repo", "/other/place")).toBe(false);
  });
});
