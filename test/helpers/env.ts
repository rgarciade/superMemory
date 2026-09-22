/**
 * SUPERMEMORY_* env sandboxing for tests (design §1.8).
 *
 * Only composition-level resolution reads these variables, so most unit
 * tests inject paths directly; this helper wraps the tests that exercise
 * launch-level env resolution. It sets and restores
 * SUPERMEMORY_CONFIG_DIR / SUPERMEMORY_VAULT around a test body.
 */

export async function withTestEnv<T>(
  opts: { configDir?: string; vault?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const savedConfigDir = process.env["SUPERMEMORY_CONFIG_DIR"];
  const savedVault = process.env["SUPERMEMORY_VAULT"];
  try {
    if (opts.configDir !== undefined) {
      process.env["SUPERMEMORY_CONFIG_DIR"] = opts.configDir;
    }
    if (opts.vault !== undefined) {
      process.env["SUPERMEMORY_VAULT"] = opts.vault;
    }
    return await fn();
  } finally {
    restore("SUPERMEMORY_CONFIG_DIR", savedConfigDir);
    restore("SUPERMEMORY_VAULT", savedVault);
  }
}

function restore(name: string, saved: string | undefined): void {
  if (saved === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = saved;
  }
}
