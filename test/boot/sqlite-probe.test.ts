import { describe, expect, it } from "vitest";
import { probeSqlite, fts5MissingMessage } from "../../src/boot/sqlite-probe.js";

// Task 1.14 [RED first]: FTS5 capability probe (OD-3). The passing smoke
// test doubles as the better-sqlite3 ESM/default-import interop proof on
// Node LTS; the failure wording is the asserted OD-3 contract.
describe("probeSqlite", () => {
  it("passes on this machine's SQLite build (FTS5 + interop smoke)", async () => {
    const result = await probeSqlite();
    expect(result.sqliteVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.betterSqlite3Version).toMatch(/^\d+\.\d+/);
  });
});

describe("fts5MissingMessage (OD-3 wording contract)", () => {
  it("carries the exact remediation contract", () => {
    const message = fts5MissingMessage("13.0.3", "3.53.4");
    expect(message).toContain(
      "supermemory: SQLite on this machine was built without FTS5 (better-sqlite3 13.0.3, SQLite 3.53.4).",
    );
    expect(message).toContain(
      "The vault search index requires FTS5 full-text search; `find` cannot work without it.",
    );
    expect(message).toContain(
      "Fix — rebuild the native module from source:",
    );
    expect(message).toContain(
      "npm rebuild better-sqlite3 --build-from-source",
    );
    expect(message).toContain("docs/TROUBLESHOOTING.md");
    expect(message).toContain("custom SQLite");
  });
});
