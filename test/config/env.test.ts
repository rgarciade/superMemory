import { describe, expect, it } from "vitest";
import {
  ENV_KEYS,
  ProcessEnvSource,
  readNumber,
  readString,
  type EnvSource,
} from "../../src/config/env.js";

// Task 1.12 [RED first]: typed SUPERMEMORY_* access via an EnvSource port.
// Tests inject a fake source — process.env is never mutated (design §1.8).
function fakeEnv(values: Record<string, string | undefined>): EnvSource {
  return { get: (name) => values[name] };
}

describe("ProcessEnvSource", () => {
  it("reads through to process.env", () => {
    const source = new ProcessEnvSource();
    const name = "SUPERMEMORY_TEST_PROBE_" + Date.now();
    process.env[name] = "value";
    try {
      expect(source.get(name)).toBe("value");
    } finally {
      delete process.env[name];
    }
  });
});

describe("ENV_KEYS", () => {
  it("names every SUPERMEMORY_* knob M1 reads", () => {
    expect(ENV_KEYS).toEqual({
      vault: "SUPERMEMORY_VAULT",
      configDir: "SUPERMEMORY_CONFIG_DIR",
      logLevel: "SUPERMEMORY_LOG_LEVEL",
      syncIntervalMinutes: "SUPERMEMORY_SYNC_INTERVAL_MINUTES",
      debounceSeconds: "SUPERMEMORY_DEBOUNCE_SECONDS",
    });
  });
});

describe("readString", () => {
  it("returns the value when set", () => {
    expect(readString(fakeEnv({ SUPERMEMORY_VAULT: "/tmp/v" }), "SUPERMEMORY_VAULT")).toBe("/tmp/v");
  });

  it("returns undefined when unset or empty", () => {
    expect(readString(fakeEnv({}), "SUPERMEMORY_VAULT")).toBeUndefined();
    expect(
      readString(fakeEnv({ SUPERMEMORY_VAULT: "" }), "SUPERMEMORY_VAULT"),
    ).toBeUndefined();
  });
});

describe("readNumber", () => {
  it("parses a positive integer", () => {
    expect(
      readNumber(fakeEnv({ SUPERMEMORY_DEBOUNCE_SECONDS: "45" }), "SUPERMEMORY_DEBOUNCE_SECONDS"),
    ).toBe(45);
  });

  it("returns undefined for unset, non-numeric, or non-positive values", () => {
    const key = "SUPERMEMORY_SYNC_INTERVAL_MINUTES";
    expect(readNumber(fakeEnv({}), key)).toBeUndefined();
    expect(readNumber(fakeEnv({ [key]: "abc" }), key)).toBeUndefined();
    expect(readNumber(fakeEnv({ [key]: "-5" }), key)).toBeUndefined();
    expect(readNumber(fakeEnv({ [key]: "0" }), key)).toBeUndefined();
  });
});
