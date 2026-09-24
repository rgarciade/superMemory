import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildCatalog } from "../../../src/mcp/catalog.js";
import { createChangesSinceHandler } from "../../../src/mcp/tools/changes-since.js";
import { parseRules } from "../../../src/rules/parser.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RulesModel } from "../../../src/rules/types.js";
import { createTestVault, FIXTURE_VAULT_DIR, type TestVault } from "../../helpers/create-test-vault.js";
import { createToolTestClient } from "../../helpers/create-tool-test-client.js";

// Task 2.14 [RED first]: changes_since — ISO timestamp -> git-log walk
// filtered to note-grammar commits, classified added/updated/
// status_changed/removed from deterministic headers. The header parser
// itself now lives in src/sync/commit-message.ts (task 3.2 absorbed it —
// one grammar home); its unit tests moved to test/sync/commit-message.test.ts.

const execFileAsync = promisify(execFile);

async function loadRules(): Promise<RulesModel> {
  const raw = await readFile(path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

/**
 * Commits with an explicit author/committer date, bypassing the vault's
 * fixed-date helper. `--allow-empty`: these commits exist only to exercise
 * changes_since's git-log parsing/classification, not real file changes —
 * P2 saves don't commit yet (SyncPort is a null impl until P3's engine).
 */
async function commitAt(vault: TestVault, message: string, isoDate: string): Promise<void> {
  await execFileAsync("git", ["commit", "--allow-empty", "-m", message], {
    cwd: vault.root,
    env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
  });
}

describe("changes_since (in-memory transport)", () => {
  it("lists each affected note exactly once, correctly classified, since a given timestamp", async () => {
    const vault = await createTestVault();
    try {
      // Before "since": a spec is added — must NOT appear in the result.
      await commitAt(vault, 'note(add): spec "Search spec" [SPEC-search]', "2026-01-01T00:00:00+00:00");

      const since = "2026-01-02T00:00:00+00:00";

      // After "since": one note created, then later status-changed (must
      // appear exactly once, as status_changed — its most recent state).
      await commitAt(vault, 'note(add): decision "Use an in-memory index" [DEC-1]', "2026-01-03T00:00:00+00:00");
      await commitAt(
        vault,
        'note(update): decision "Use an in-memory index" [DEC-1] (status: proposed→accepted)',
        "2026-01-04T00:00:00+00:00",
      );
      // A second, independently-created note.
      await commitAt(vault, 'note(add): incident "Search returned stale results" [INC-1]', "2026-01-05T00:00:00+00:00");
      // An unrelated commit — must be excluded (not note grammar).
      await commitAt(vault, "chore(index): regenerate maps (2 notes)", "2026-01-06T00:00:00+00:00");

      const rules = await loadRules();
      const catalog = buildCatalog(rules);
      const def = catalog.tools.find((t) => t.name === "changes_since");
      if (!def) throw new Error("catalog must declare changes_since");

      const { client, close } = await createToolTestClient([
        {
          name: def.name,
          description: def.description,
          inputSchema: def.inputSchema,
          handler: createChangesSinceHandler({ vaultPath: vault.root }) as never,
        },
      ]);
      try {
        const result = await client.callTool({ name: "changes_since", arguments: { since } });
        const payload = result.structuredContent as {
          changes: Array<{ id?: string; classification: string }>;
        };
        expect(payload.changes).toHaveLength(2);
        const byId = new Map(payload.changes.map((c) => [c.id, c]));
        expect(byId.get("DEC-1")?.classification).toBe("status_changed");
        expect(byId.get("INC-1")?.classification).toBe("added");
      } finally {
        await close();
      }
    } finally {
      await vault.cleanup();
    }
  });

  // Fresh-context review finding 9: `new Date("garbage")` is a truthy
  // Invalid Date, so an unparseable "since" timestamp was silently
  // misinterpreted (every comparison against it is false) instead of
  // raising an actionable error.
  it("rejects an unparseable since timestamp with an actionable error", async () => {
    const vault = await createTestVault();
    try {
      const rules = await loadRules();
      const catalog = buildCatalog(rules);
      const def = catalog.tools.find((t) => t.name === "changes_since");
      if (!def) throw new Error("catalog must declare changes_since");

      const { client, close } = await createToolTestClient([
        {
          name: def.name,
          description: def.description,
          inputSchema: def.inputSchema,
          handler: createChangesSinceHandler({ vaultPath: vault.root }) as never,
        },
      ]);
      try {
        const result = await client.callTool({
          name: "changes_since",
          arguments: { since: "not-a-timestamp" },
        });
        expect(result.isError).toBe(true);
      } finally {
        await close();
      }
    } finally {
      await vault.cleanup();
    }
  });
});
