import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node environment (default). No globals: tests import
    // { describe, it, expect, vi } explicitly (design §1.7).
    // (vitest 5 renamed testMatch -> include; same semantics.)
    include: ["test/**/*.test.ts"],
    globals: false,
    // Isolates every child `git` process from the developer/CI runner's
    // own ~/.gitconfig and /etc/gitconfig, and gives every commit a
    // fixed working identity (finding #8: test hermeticity).
    setupFiles: ["test/setup/git-env.ts"],
  },
});
