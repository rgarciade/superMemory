import { describe, expect, it } from "vitest";
import { AppError } from "../../src/util/errors.js";
import {
  SUPPORTED_FORMAT_VERSION,
  checkFormatVersion,
} from "../../src/rules/version.js";

// Task 1.8 [RED first]: format_version contract (rules-parsing spec).
// Same major accepted; higher major refused with an actionable error
// naming the required version and directing the user to update the app.
describe("checkFormatVersion", () => {
  it("accepts a same-major version (1.0 on a 1.x build)", () => {
    expect(() => checkFormatVersion("1.0")).not.toThrow();
  });

  it("accepts minor/patch bumps within the same major (backward compatible)", () => {
    expect(() => checkFormatVersion("1.2.3")).not.toThrow();
  });

  it("refuses a higher major with an error naming format 2.x and the update path", () => {
    try {
      checkFormatVersion("2.0");
      expect.unreachable("must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe("FORMAT_VERSION_UNSUPPORTED");
      expect(appErr.message).toContain("format 2.x");
      expect(appErr.message).toContain("update");
      expect(appErr.hint).toBeTruthy();
    }
  });

  it("refuses any other mismatching major the same way", () => {
    expect(() => checkFormatVersion("3.1")).toThrowError(AppError);
  });

  it("refuses a missing version with the same error code", () => {
    expect(() => checkFormatVersion(undefined)).toThrowError(AppError);
  });

  it("refuses a non-semver version string", () => {
    expect(() => checkFormatVersion("banana")).toThrowError(AppError);
  });

  it("exposes the supported version this build answers for", () => {
    expect(SUPPORTED_FORMAT_VERSION.startsWith("1.")).toBe(true);
  });
});
