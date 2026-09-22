import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node environment (default). No globals: tests import
    // { describe, it, expect, vi } explicitly (design §1.7).
    // (vitest 5 renamed testMatch -> include; same semantics.)
    include: ["test/**/*.test.ts"],
    globals: false,
  },
});
