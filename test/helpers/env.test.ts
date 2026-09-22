import { describe, expect, it } from "vitest";
import { withTestEnv } from "./env.js";

// Task 1.5: SUPERMEMORY_* sandboxing — sets and restores both vars.
describe("withTestEnv", () => {
  it("sets SUPERMEMORY_CONFIG_DIR and SUPERMEMORY_VAULT inside the block", async () => {
    await withTestEnv(
      { configDir: "/tmp/sm-cfg", vault: "/tmp/sm-vault" },
      async () => {
        expect(process.env["SUPERMEMORY_CONFIG_DIR"]).toBe("/tmp/sm-cfg");
        expect(process.env["SUPERMEMORY_VAULT"]).toBe("/tmp/sm-vault");
      },
    );
  });

  it("restores previous values afterwards (including unset)", async () => {
    const savedConfig = process.env["SUPERMEMORY_CONFIG_DIR"];
    process.env["SUPERMEMORY_CONFIG_DIR"] = "/tmp/sm-saved";
    delete process.env["SUPERMEMORY_VAULT"];
    try {
      await withTestEnv(
        { configDir: "/tmp/sm-inner", vault: "/tmp/sm-inner-vault" },
        async () => {
          expect(process.env["SUPERMEMORY_VAULT"]).toBe("/tmp/sm-inner-vault");
        },
      );
      expect(process.env["SUPERMEMORY_CONFIG_DIR"]).toBe("/tmp/sm-saved");
      expect(process.env["SUPERMEMORY_VAULT"]).toBeUndefined();
    } finally {
      if (savedConfig === undefined) {
        delete process.env["SUPERMEMORY_CONFIG_DIR"];
      } else {
        process.env["SUPERMEMORY_CONFIG_DIR"] = savedConfig;
      }
    }
  });

  it("restores env even when the body throws", async () => {
    await expect(
      withTestEnv({ vault: "/tmp/sm-boom" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(process.env["SUPERMEMORY_VAULT"]).toBeUndefined();
  });
});
