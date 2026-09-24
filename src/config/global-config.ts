import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EnvSource } from "./env.js";

/**
 * Per-user global config (`config.json` under SUPERMEMORY_CONFIG_DIR |
 * ~/.config/supermemory — RFC §8). Lives outside any repo; `setup` is
 * the only writer in M1. Tests point the config dir at tmp, never the
 * real HOME.
 */

export interface GlobalConfig {
  vaults: { default?: string };
  author?: { name?: string; email?: string };
}

export function configDirFor(env: EnvSource): string {
  return env.get("SUPERMEMORY_CONFIG_DIR") ?? defaultConfigDir();
}

export function defaultConfigDir(): string {
  return path.join(os.homedir(), ".config", "supermemory");
}

export async function loadGlobalConfig(env: EnvSource): Promise<GlobalConfig> {
  const file = configFilePath(env);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { vaults: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GlobalConfig>;
    return normalize(parsed);
  } catch {
    // A corrupt config behaves as "not configured" — boot paths give the
    // actionable NO_VAULT_CONFIGURED error; setup rewrites the file.
    return { vaults: {} };
  }
}

export async function saveGlobalConfig(
  env: EnvSource,
  config: GlobalConfig,
): Promise<void> {
  const file = configFilePath(env);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function resolveDefaultVault(config: GlobalConfig): string | undefined {
  return config.vaults.default;
}

function configFilePath(env: EnvSource): string {
  return path.join(configDirFor(env), "config.json");
}

function normalize(parsed: Partial<GlobalConfig>): GlobalConfig {
  const vaults = parsed.vaults;
  const author = parsed.author;
  return {
    vaults:
      typeof vaults === "object" && vaults !== null
        ? { ...(vaults as { default?: string }) }
        : {},
    ...(typeof author === "object" && author !== null ? { author } : {}),
  };
}
