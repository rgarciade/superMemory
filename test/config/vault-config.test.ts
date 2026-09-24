import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_DEBOUNCE_SECONDS,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  loadVaultConfig,
  resolveSyncTunables,
} from "../../src/config/vault-config.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import type { EnvSource } from "../../src/config/env.js";
import { FIXTURE_VAULT_DIR } from "../helpers/create-test-vault.js";

// Task 1.13 [RED first]: .memory/config.yml loading + sync tunables
// precedence env > config.yml sync: > rules git: block > built-ins
// (design §3.2). Timing knobs only — no hygiene gate overridable.
const fixtureContent = await readFile(
  path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"),
  "utf8",
);
const fixtureRules: RulesModel = parseRules(fixtureContent);

function env(values: Record<string, string | undefined>): EnvSource {
  return { get: (name) => values[name] };
}

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

describe("built-in defaults", () => {
  it("default to 15 min interval / 45 s debounce (RFC defaults)", () => {
    expect(DEFAULT_SYNC_INTERVAL_MINUTES).toBe(15);
    expect(DEFAULT_DEBOUNCE_SECONDS).toBe(45);
  });

  it("resolve to built-ins when nothing else declares them", () => {
    const tunables = resolveSyncTunables(env({}), undefined, {
      ...fixtureRules,
      git: {},
    });
    expect(tunables.intervalMs).toBe(15 * MINUTE_MS);
    expect(tunables.debounceMs).toBe(45 * SECOND_MS);
  });
});

describe("precedence", () => {
  it("rules git: block seeds the tunables", () => {
    // fixture declares sync_interval_minutes: 15 / debounce_seconds: 45
    const tunables = resolveSyncTunables(env({}), undefined, fixtureRules);
    expect(tunables.intervalMs).toBe(15 * MINUTE_MS);
    expect(tunables.debounceMs).toBe(45 * SECOND_MS);
  });

  it("config.yml sync: overrides the rules git: block", () => {
    const tunables = resolveSyncTunables(
      env({}),
      { sync: { sync_interval_minutes: 30, debounce_seconds: 60 } },
      { ...fixtureRules, git: { syncIntervalMinutes: 15, debounceSeconds: 45 } },
    );
    expect(tunables.intervalMs).toBe(30 * MINUTE_MS);
    expect(tunables.debounceMs).toBe(60 * SECOND_MS);
  });

  it("env overrides config.yml and rules", () => {
    const tunables = resolveSyncTunables(
      env({
        SUPERMEMORY_SYNC_INTERVAL_MINUTES: "5",
        SUPERMEMORY_DEBOUNCE_SECONDS: "10",
      }),
      { sync: { sync_interval_minutes: 30, debounce_seconds: 60 } },
      fixtureRules,
    );
    expect(tunables.intervalMs).toBe(5 * MINUTE_MS);
    expect(tunables.debounceMs).toBe(10 * SECOND_MS);
  });

  it("each knob resolves independently per-knob precedence", () => {
    const tunables = resolveSyncTunables(
      env({ SUPERMEMORY_DEBOUNCE_SECONDS: "20" }),
      { sync: { sync_interval_minutes: 30 } },
      fixtureRules, // interval 15, debounce 45
    );
    expect(tunables.intervalMs).toBe(30 * MINUTE_MS); // config wins
    expect(tunables.debounceMs).toBe(20 * SECOND_MS); // env wins
  });

  it("invalid env values fall through to lower layers", () => {
    const tunables = resolveSyncTunables(
      env({ SUPERMEMORY_SYNC_INTERVAL_MINUTES: "abc" }),
      undefined,
      fixtureRules,
    );
    expect(tunables.intervalMs).toBe(15 * MINUTE_MS);
  });
});

describe("loadVaultConfig", () => {
  it("loads .memory/config.yml from a test vault", async () => {
    const { createTestVault } = await import(
      "../helpers/create-test-vault.js"
    );
    const vault = await createTestVault();
    try {
      const config = await loadVaultConfig(vault.paths.configPath);
      expect(config.sync).toEqual({}); // fixture comments the knobs out
    } finally {
      await vault.cleanup();
    }
  });

  it("missing file yields an empty config", async () => {
    const config = await loadVaultConfig("/nonexistent/config.yml");
    expect(config).toEqual({});
  });
});
