/**
 * Hermetic git isolation for the test suite (finding #8 remediation).
 *
 * Every child `git` process spawned by simple-git or execFile inherits
 * `process.env`, so a test suite that never overrides it silently
 * depends on whatever the developer or CI runner has in `~/.gitconfig`
 * (hooks path, `commit.gpgsign`, aliases) or `/etc/gitconfig`.
 *
 * Two independent pieces:
 *
 * 1. Config isolation (GIT_CONFIG_GLOBAL/GIT_CONFIG_NOSYSTEM) is applied
 *    process-wide as a vitest `setupFiles` side effect below — it is
 *    always safe: it only removes the developer's global/system config,
 *    it never touches a repo's LOCAL config, so tests that configure
 *    their own local `user.name`/`user.email` (the existing pattern in
 *    `create-test-vault.ts`, `create-remote.ts`, `init.test.ts`) keep
 *    working unchanged and their commit author assertions stay accurate.
 * 2. A fixed author/committer identity (`buildHermeticGitEnv`) is
 *    deliberately NOT applied process-wide: GIT_AUTHOR_NAME/EMAIL env
 *    vars always win over `user.name`/`user.email` config, so forcing
 *    them globally would silently overwrite every test's intentional
 *    local identity (e.g. assertions on `git log`'s author name). It is
 *    exported for callers that explicitly want a fully self-contained
 *    env for one `execFile` git call with no local identity configured
 *    at all — the scenario `user.useConfigOnly=true` reproduces.
 */

const FIXED_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "supermemory-test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "supermemory-test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
} as const;

const CONFIG_ISOLATION = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
} as const;

/**
 * Pure: `base` merged with config isolation AND a fixed fallback
 * identity — a fully self-contained env for an explicit `execFile` git
 * call that must not depend on any local or global identity.
 */
export function buildHermeticGitEnv(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...base, ...CONFIG_ISOLATION, ...FIXED_GIT_IDENTITY };
}

/** Applies `buildHermeticGitEnv` onto `target` and returns it. */
export function applyHermeticGitEnv(
  target: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  Object.assign(target, buildHermeticGitEnv(target));
  return target;
}

/**
 * Pure: `base` merged with ONLY config isolation — safe to apply
 * process-wide, never overrides a repo's local identity config.
 */
export function buildHermeticGitConfigIsolation(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...base, ...CONFIG_ISOLATION };
}

/** Applies config isolation (only) onto `target` and returns it. */
export function applyHermeticGitConfigIsolation(
  target: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  Object.assign(target, buildHermeticGitConfigIsolation(target));
  return target;
}

// Side effect: this module IS the vitest `setupFiles` entry
// (vitest.config.ts) — loading it isolates every child `git` process,
// for the rest of this worker's test files, from the developer/CI
// runner's own global and system git config.
applyHermeticGitConfigIsolation();
