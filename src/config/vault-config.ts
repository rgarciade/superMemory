import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { ENV_KEYS, readNumber, type EnvSource } from "./env.js";
import type { RulesModel } from "../rules/types.js";

/**
 * `.memory/config.yml` (team sync policy, committed — RFC §8) and the
 * sync tunables resolution (design §3.2):
 *
 *   env (SUPERMEMORY_SYNC_INTERVAL_MINUTES / SUPERMEMORY_DEBOUNCE_SECONDS)
 *     > config.yml `sync:` section
 *     > rules.md `git:` block
 *     > built-ins (15 min / 45 s)
 *
 * Timing knobs ONLY — hygiene gates (secrets lint, validation) are never
 * part of this precedence chain.
 */

export const DEFAULT_SYNC_INTERVAL_MINUTES = 15;
export const DEFAULT_DEBOUNCE_SECONDS = 45;

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

export interface VaultConfig {
  sync?: {
    sync_interval_minutes?: number;
    debounce_seconds?: number;
  };
}

export interface SyncTunables {
  intervalMs: number;
  debounceMs: number;
}

export async function loadVaultConfig(configPath: string): Promise<VaultConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) return {};
    const sync = parsed["sync"];
    if (sync === null) return { sync: {} }; // key present, knobs commented out
    if (typeof sync !== "object" || sync === null) return {};
    return { sync: sync as VaultConfig["sync"] };
  } catch {
    // A malformed config.yml falls back to built-ins; the rules file and
    // boot validation remain the authoritative surfaces.
    return {};
  }
}

export function resolveSyncTunables(
  env: EnvSource,
  vaultConfig: VaultConfig | undefined,
  rules: RulesModel,
): SyncTunables {
  const intervalMinutes =
    readNumber(env, ENV_KEYS.syncIntervalMinutes) ??
    vaultConfig?.sync?.sync_interval_minutes ??
    rules.git.syncIntervalMinutes ??
    DEFAULT_SYNC_INTERVAL_MINUTES;
  const debounceSeconds =
    readNumber(env, ENV_KEYS.debounceSeconds) ??
    vaultConfig?.sync?.debounce_seconds ??
    rules.git.debounceSeconds ??
    DEFAULT_DEBOUNCE_SECONDS;
  return {
    intervalMs: intervalMinutes * MINUTE_MS,
    debounceMs: debounceSeconds * SECOND_MS,
  };
}
