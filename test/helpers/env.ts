/**
 * SUPERMEMORY_* env sandboxing for tests (design §1.8).
 *
 * Only composition-level resolution reads these variables, so most unit
 * tests inject paths directly; this helper wraps the tests that exercise
 * launch-level env resolution. It sets and restores SUPERMEMORY_VAULT
 * around a test body. (The configDir knob died with the global config —
 * add-project-config task 4.5.)
 */

export async function withTestEnv<T>(
  opts: { vault?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const savedVault = process.env["SUPERMEMORY_VAULT"];
  try {
    if (opts.vault !== undefined) {
      process.env["SUPERMEMORY_VAULT"] = opts.vault;
    }
    return await fn();
  } finally {
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
