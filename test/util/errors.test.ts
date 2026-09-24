import { describe, expect, it } from "vitest";
import { AppError, ERROR_CODES } from "../../src/util/errors.js";

// Task 1.6 [RED first]: AppError shape + stable error codes (design §1.5).
describe("AppError", () => {
  it("carries code, message, and optional hint", () => {
    const err = new AppError("TEST_CODE", "something failed", {
      hint: "try this instead",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("something failed");
    expect(err.hint).toBe("try this instead");
  });

  it("hint is optional", () => {
    const err = new AppError("TEST_CODE", "bare failure");
    expect(err.hint).toBeUndefined();
  });

  it("exposes the stable error codes every module asserts against", () => {
    expect(ERROR_CODES).toEqual({
      RULES_PARSE_ERROR: "RULES_PARSE_ERROR",
      FORMAT_VERSION_UNSUPPORTED: "FORMAT_VERSION_UNSUPPORTED",
      BOOT_VALIDATION_FAILED: "BOOT_VALIDATION_FAILED",
      SECRETS_BLOCKED: "SECRETS_BLOCKED",
      LOCK_HELD: "LOCK_HELD",
      CONFLICT_CURATED: "CONFLICT_CURATED",
      NO_VAULT_CONFIGURED: "NO_VAULT_CONFIGURED",
      // add-project-config AD-2: setup refuses the home root and any
      // location outside a Git work tree (one code added, none removed).
      SETUP_LOCATION_REFUSED: "SETUP_LOCATION_REFUSED",
      // issue #5: setup aborts after repeated invalid timing input.
      INVALID_SYNC_SETTING: "INVALID_SYNC_SETTING",
    });
  });

  it("serializes code + message + hint for CLI/MCP reporting", () => {
    const err = new AppError("RULES_PARSE_ERROR", "block `note_types` is malformed", {
      hint: "fix the YAML around line 12",
    });
    expect(err.toString()).toContain("RULES_PARSE_ERROR");
    expect(err.toString()).toContain("block `note_types` is malformed");
    expect(err.toString()).toContain("fix the YAML around line 12");
  });
});
