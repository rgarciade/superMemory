import { describe, expect, it } from "vitest";
import { withTestEnv } from "./env.js";

// Task 1.5: SUPERMEMORY_* sandboxing — sets and restores the var.
// (The configDir coverage died with the global config — add-project-
// config task 4.5; SUPERMEMORY_VAULT is the surviving knob.)
describe("withTestEnv", () => {
  it("sets SUPERMEMORY_VAULT inside the block", async () => {
    await withTestEnv({ vault: "/tmp/sm-vault" }, async () => {
      expect(process.env["SUPERMEMORY_VAULT"]).toBe("/tmp/sm-vault");
    });
  });

  it("restores previous values afterwards (including unset)", async () => {
    await withTestEnv({ vault: "/tmp/sm-inner-vault" }, async () => {
      expect(process.env["SUPERMEMORY_VAULT"]).toBe("/tmp/sm-inner-vault");
    });
    expect(process.env["SUPERMEMORY_VAULT"]).toBeUndefined();
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
