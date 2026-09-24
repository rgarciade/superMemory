import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  configDirFor,
  loadGlobalConfig,
  saveGlobalConfig,
  resolveDefaultVault,
} from "../../src/config/global-config.js";
import type { EnvSource } from "../../src/config/env.js";

// Task 1.12 [RED first]: global config.json under SUPERMEMORY_CONFIG_DIR |
// ~/.config/supermemory. Tests point the config dir at tmp — never the
// real HOME (design §1.8).

function envWith(configDir: string): EnvSource {
  return { get: (name) => (name === "SUPERMEMORY_CONFIG_DIR" ? configDir : undefined) };
}

describe("configDirFor", () => {
  it("prefers SUPERMEMORY_CONFIG_DIR when set", () => {
    expect(configDirFor(envWith("/tmp/sm-cfg"))).toBe("/tmp/sm-cfg");
  });

  it("falls back to ~/.config/supermemory", () => {
    const env: EnvSource = { get: () => undefined };
    expect(configDirFor(env)).toBe(
      path.join(os.homedir(), ".config", "supermemory"),
    );
  });
});

describe("loadGlobalConfig / saveGlobalConfig", () => {
  it("returns an empty config when the file does not exist", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sm-empty-"));
    try {
      const config = await loadGlobalConfig(envWith(dir));
      expect(config).toEqual({ vaults: {} });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips vaults.default and author, writing config.json", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sm-cfg-"));
    try {
      await saveGlobalConfig(envWith(dir), {
        vaults: { default: "/tmp/my-vault" },
        author: { name: "Raul", email: "raul@example.com" },
      });
      const raw = JSON.parse(
        await readFile(path.join(dir, "config.json"), "utf8"),
      ) as { vaults: { default: string }; author: { name: string } };
      expect(raw.vaults.default).toBe("/tmp/my-vault");
      expect(raw.author.name).toBe("Raul");

      const loaded = await loadGlobalConfig(envWith(dir));
      expect(loaded.vaults.default).toBe("/tmp/my-vault");
      expect(loaded.author?.email).toBe("raul@example.com");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates the config directory when missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sm-mk-"));
    const nested = path.join(dir, "deep", "config");
    try {
      await saveGlobalConfig(envWith(nested), { vaults: { default: "/v" } });
      const loaded = await loadGlobalConfig(envWith(nested));
      expect(loaded.vaults.default).toBe("/v");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveDefaultVault", () => {
  it("resolves the default vault from the config", () => {
    expect(
      resolveDefaultVault({ vaults: { default: "/tmp/vault" } }),
    ).toBe("/tmp/vault");
  });

  it("returns undefined when no default is configured", () => {
    expect(resolveDefaultVault({ vaults: {} })).toBeUndefined();
  });
});
