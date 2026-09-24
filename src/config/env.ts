/**
 * Typed SUPERMEMORY_* access (design §1.6: env is read only at the
 * edges). Core modules take explicit parameters; tests inject a fake
 * source instead of mutating process.env (§1.8).
 */

export interface EnvSource {
  get(name: string): string | undefined;
}

export class ProcessEnvSource implements EnvSource {
  get(name: string): string | undefined {
    return process.env[name];
  }
}

/** Every SUPERMEMORY_* knob M1 reads (RFC §8; timing knobs only for sync).
 *  The config-dir knob died with the global config (add-project-config
 *  task 4.5 — there is no global config location anymore). */
export const ENV_KEYS = {
  vault: "SUPERMEMORY_VAULT",
  logLevel: "SUPERMEMORY_LOG_LEVEL",
  syncIntervalMinutes: "SUPERMEMORY_SYNC_INTERVAL_MINUTES",
  debounceSeconds: "SUPERMEMORY_DEBOUNCE_SECONDS",
} as const;

export function readString(env: EnvSource, name: string): string | undefined {
  const value = env.get(name);
  return value !== undefined && value !== "" ? value : undefined;
}

/** Positive finite numbers only; anything else is "unset". */
export function readNumber(env: EnvSource, name: string): number | undefined {
  const raw = env.get(name);
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}
