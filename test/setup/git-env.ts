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
 * 1. Config isolation (GIT_CONFIG_GLOBAL/GIT_CONFIG_NOSYSTEM, plus
 *    clearing every other env-based way git can be redirected or
 *    configured — see `clearGitEnvNoise`) is applied process-wide as a
 *    vitest `setupFiles` side effect below — it is always safe: it only
 *    removes the developer/CI's own global/system config and any
 *    inherited git-process env noise, it never touches a repo's LOCAL
 *    config, so tests that configure their own local
 *    `user.name`/`user.email` (the existing pattern in
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
 * Env vars that redirect git to a specific repository or inject config
 * purely through the environment — a vitest worker launched from a git
 * hook (e.g. husky's `pre-commit` running `npm test`) can inherit
 * GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE pointing at the INVOKING repo,
 * silently redirecting every `git` child process in the suite there
 * instead of the test's own tmp repo. GIT_CONFIG_COUNT/
 * GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n/GIT_CONFIG_PARAMETERS are a
 * second, independent way to inject config that GIT_CONFIG_GLOBAL/
 * GIT_CONFIG_NOSYSTEM do not cover at all.
 */
const GIT_ENV_VARS_TO_CLEAR = [
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_WORK_TREE",
] as const;

const GIT_CONFIG_KEY_VALUE_PATTERN = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/;

/**
 * Deletes every git env-noise var (see above) from `env` IN PLACE and
 * returns it. Mutating in place (rather than building a new object
 * without those keys) matters for the `apply*` functions below:
 * `Object.assign(target, source)` can only ADD/overwrite keys present
 * on `source` — it can never delete a key `target` already has but
 * `source` omits. So clearing process.env's own GIT_DIR etc. requires
 * an explicit `delete`, not "assign an object that doesn't have it".
 */
function clearGitEnvNoiseInPlace(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const key of GIT_ENV_VARS_TO_CLEAR) {
    delete env[key];
  }
  for (const key of Object.keys(env)) {
    if (GIT_CONFIG_KEY_VALUE_PATTERN.test(key)) {
      delete env[key];
    }
  }
  return env;
}

/**
 * Pure: `base` merged with config isolation AND a fixed fallback
 * identity — a fully self-contained env for an explicit `execFile` git
 * call that must not depend on any local or global identity.
 */
export function buildHermeticGitEnv(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...clearGitEnvNoiseInPlace({ ...base }),
    ...CONFIG_ISOLATION,
    ...FIXED_GIT_IDENTITY,
  };
}

/** Applies `buildHermeticGitEnv`'s overrides directly onto `target`. */
export function applyHermeticGitEnv(
  target: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  clearGitEnvNoiseInPlace(target);
  Object.assign(target, CONFIG_ISOLATION, FIXED_GIT_IDENTITY);
  return target;
}

/**
 * Pure: `base` merged with ONLY config isolation — safe to apply
 * process-wide, never overrides a repo's local identity config.
 */
export function buildHermeticGitConfigIsolation(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...clearGitEnvNoiseInPlace({ ...base }), ...CONFIG_ISOLATION };
}

/** Applies config isolation (only)'s overrides directly onto `target`. */
export function applyHermeticGitConfigIsolation(
  target: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  clearGitEnvNoiseInPlace(target);
  Object.assign(target, CONFIG_ISOLATION);
  return target;
}

// Side effect: this module IS the vitest `setupFiles` entry
// (vitest.config.ts) — loading it isolates every child `git` process,
// for the rest of this worker's test files, from the developer/CI
// runner's own global and system git config.
applyHermeticGitConfigIsolation();
