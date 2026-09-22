import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node environment (default). No globals: tests import
    // { describe, it, expect, vi } explicitly (design §1.7).
    // (vitest 5 renamed testMatch -> include; same semantics.)
    include: ["test/**/*.test.ts"],
    globals: false,
    // Isolates every child `git` process from the developer/CI runner's
    // own ~/.gitconfig, /etc/gitconfig, and any inherited GIT_DIR/
    // GIT_CONFIG_* env noise (e.g. tests launched from a git hook).
    // Deliberately does NOT force a fixed author/committer identity
    // process-wide — see test/setup/git-env.ts for why (finding #8:
    // test hermeticity).
    setupFiles: ["test/setup/git-env.ts"],
  },
});
