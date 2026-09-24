import { describe, expect, it } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withTestEnv } from "../helpers/env.js";
import { createTestVault } from "../helpers/create-test-vault.js";

// Task 1.19 [phase gate]: hermeticity guards — test vaults only ever
// live in os.tmpdir(), and withTestEnv restores the sandboxed
// variables. (The global-config scenario was deleted with the module —
// add-project-config task 4.5; its hermeticity job is inherited by the
// project-dir fixture tests, whose loaders touch only basePath trees.)

describe("P1 phase gate — hermeticity guards", () => {
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
    // Save/clear/restore SUPERMEMORY_VAULT itself: this test must pass
    // whether or not the developer running it happens to have
    // SUPERMEMORY_VAULT exported in their own shell — asserting
    // `toBeUndefined()` unconditionally after restore is only correct
    // when the pre-test value actually was undefined.
    const original = process.env["SUPERMEMORY_VAULT"];
    delete process.env["SUPERMEMORY_VAULT"];
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
      if (original === undefined) {
        delete process.env["SUPERMEMORY_VAULT"];
      } else {
        process.env["SUPERMEMORY_VAULT"] = original;
      }
    }
  });
});
