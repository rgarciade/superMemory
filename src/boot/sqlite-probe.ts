import Database from "better-sqlite3";
import pkg from "better-sqlite3/package.json" with { type: "json" };
import { AppError } from "../util/errors.js";

/**
 * FTS5 capability probe (OD-3). Runs on every serve boot and on any
 * init/setup that will exercise the index, immediately before the index
 * is opened/created. The import above (NodeNext default-import interop
 * for the CJS `better-sqlite3`) doubles as the P1 ESM-interop smoke —
 * the test that calls probeSqlite() proves it on the CI Node-LTS matrix.
 */

export interface SqliteProbeResult {
  sqliteVersion: string;
  betterSqlite3Version: string;
}

export async function probeSqlite(): Promise<SqliteProbeResult> {
  const db = new Database(":memory:");
  let sqliteVersion = "unknown";
  try {
    db.exec("CREATE VIRTUAL TABLE temp.sm_fts5_probe USING fts5(probe)");
    sqliteVersion = captureSqliteVersion(db);
    return {
      sqliteVersion,
      betterSqlite3Version: pkg.version,
    };
  } catch (err) {
    if (sqliteVersion === "unknown") {
      sqliteVersion = captureSqliteVersion(db);
    }
    throw new AppError(
      "SQLITE_FTS5_MISSING",
      fts5MissingMessage(pkg.version, sqliteVersion),
      { cause: err instanceof Error ? err : undefined },
    );
  } finally {
    db.close();
  }
}

function captureSqliteVersion(db: InstanceType<typeof Database>): string {
  try {
    const row = db
      .prepare("SELECT sqlite_version() AS version")
      .get() as { version?: string } | undefined;
    return row?.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** The OD-3 failure wording contract (asserted verbatim by test). */
export function fts5MissingMessage(
  pkgVersion: string,
  sqliteVersion: string,
): string {
  return [
    `supermemory: SQLite on this machine was built without FTS5 (better-sqlite3 ${pkgVersion}, SQLite ${sqliteVersion}).`,
    "The vault search index requires FTS5 full-text search; `find` cannot work without it.",
    "",
    "Fix — rebuild the native module from source:",
    "  npm rebuild better-sqlite3 --build-from-source",
    "(requires a C compiler + Python toolchain; see docs/TROUBLESHOOTING.md)",
    "",
    "Prebuilt binaries shipped with better-sqlite3 normally include FTS5 — a missing FTS5",
    "usually means a custom SQLite build was picked up. See docs/TROUBLESHOOTING.md#fts5.",
  ].join("\n");
}
