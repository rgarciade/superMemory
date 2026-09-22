import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfigDir, saveGlobalConfig } from "../../src/config/global-config.js";
import type { EnvSource } from "../../src/config/env.js";
import { withTestEnv } from "../helpers/env.js";
import { createTestVault } from "../helpers/create-test-vault.js";

// Task 1.19 [phase gate]: hermeticity guards — the suite never writes to
// the real HOME config, test vaults only ever live in os.tmpdir(), and
// withTestEnv restores the sandboxed variables.

describe("P1 phase gate — hermeticity guards", () => {
  it("a global-config save under an injected tmp dir never creates the real config dir", async () => {
    const realConfigDir = defaultConfigDir();
    const existedBefore = existsSync(realConfigDir);
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sm-gate-"));
    const env: EnvSource = {
      get: (name) =>
        name === "SUPERMEMORY_CONFIG_DIR" ? tmpDir : undefined,
    };
    try {
      await saveGlobalConfig(env, { vaults: { default: "/tmp/v" } });
      const written = JSON.parse(
        await readFile(path.join(tmpDir, "config.json"), "utf8"),
      ) as { vaults: { default: string } };
      expect(written.vaults.default).toBe("/tmp/v");
      if (!existedBefore) {
        expect(existsSync(realConfigDir)).toBe(false);
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("test vaults are always materialized under os.tmpdir()", async () => {
    const vault = await createTestVault();
    try {
      const expectedPrefix = path.resolve(os.tmpdir());
      expect(path.resolve(vault.root).startsWith(expectedPrefix)).toBe(true);
    } finally {
      await vault.cleanup();
    }
  });

  it("withTestEnv restores SUPERMEMORY_* around a body", async () => {
    await mkdir(path.join(os.tmpdir(), "sm-gate-env"), { recursive: true });
    try {
      await withTestEnv({ vault: "/tmp/sm-gate-env" }, async () => {
        expect(process.env["SUPERMEMORY_VAULT"]).toBe("/tmp/sm-gate-env");
      });
      expect(process.env["SUPERMEMORY_VAULT"]).toBeUndefined();
    } finally {
      await rm(path.join(os.tmpdir(), "sm-gate-env"), {
        recursive: true,
        force: true,
      });
    }
  });
});
