import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../src/util/errors.js";
import { parseRules, loadRules } from "../../src/rules/parser.js";
import {
  createTestVault,
  FIXTURE_VAULT_DIR,
} from "../helpers/create-test-vault.js";

// Task 1.9 [RED first]: rules.md v1 parser — table-driven over the
// committed fixture vault (rules-parsing spec).
const fixtureContent = await readFile(
  path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"),
  "utf8",
);

describe("parseRules — valid fixture parses completely", () => {
  it("extracts format_version and all four fenced blocks", () => {
    const rules = parseRules(fixtureContent);
    expect(rules.formatVersion).toBe("1.0");
    expect(Object.keys(rules.noteTypes).sort()).toEqual([
      "decision",
      "incident",
      "session_log",
      "spec",
    ]);
  });

  it("exposes per-type folder, frontmatter fields, naming, conflict policy", () => {
    const rules = parseRules(fixtureContent);
    const spec = rules.noteTypes["spec"];
    expect(spec?.folder).toBe("specs/");
    expect(spec?.frontmatter["spec_id"]).toEqual({
      type: "string",
      required: true,
      pattern: "SPEC-[a-z0-9-]+",
    });
    expect(spec?.frontmatter["status"]).toEqual({
      type: "enum",
      required: true,
      values: ["draft", "active", "deprecated"],
    });
    expect(spec?.frontmatter["review_after"]).toEqual({
      type: "date",
      required: false,
    });
    expect(spec?.naming).toBe("{spec_id}-{slug}.md");
    expect(spec?.conflictPolicy).toBe("human_required");

    const sessionLog = rules.noteTypes["session_log"];
    expect(sessionLog?.conflictPolicy).toBe("union");
    expect(sessionLog?.naming).toBeUndefined();
  });

  it("exposes lifecycle, conflict policy defaults, and git settings", () => {
    const rules = parseRules(fixtureContent);
    expect(rules.lifecycle.staleness?.field).toBe("review_after");
    expect(rules.lifecycle.archive?.folder).toBe("attic/");
    expect(rules.conflictPolicyDefaults["session_logs"]).toBe("union");
    expect(rules.git.mode).toBe("auto");
    expect(rules.git.syncIntervalMinutes).toBe(15);
    expect(rules.git.debounceSeconds).toBe(45);
    expect(rules.git.generatedPaths).toContain("index/");
  });
});

describe("parseRules — malformed blocks fail with located errors", () => {
  const brokenBlocks: Array<[string, string]> = [
    ["note_types", "note_types"],
    ["lifecycle", "lifecycle"],
    ["conflict_policy_defaults", "conflict_policy_defaults"],
    ["git", "git"],
  ];

  it.each(brokenBlocks)("malformed `%s` names the block and a line area", (_name, key) => {
    const broken = fixtureContent.replace(`${key}:`, `${key}: [unclosed`);
    try {
      parseRules(broken);
      expect.unreachable("must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe("RULES_PARSE_ERROR");
      expect(appErr.message).toContain(key);
      expect(appErr.message).toMatch(/\bline \d+\b/);
    }
  });

  it("serves no partial model as valid", () => {
    const broken = fixtureContent.replace("note_types:", "note_types: [unclosed");
    expect(() => parseRules(broken)).toThrow();
  });
});

describe("parseRules — required blocks and version contract", () => {
  it("missing required block fails naming that block", () => {
    const stripped = fixtureContent.replace(
      /```yaml\nlifecycle:[\s\S]*?```/,
      "",
    );
    try {
      parseRules(stripped);
      expect.unreachable("must throw");
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe("RULES_PARSE_ERROR");
      expect(appErr.message).toContain("lifecycle");
    }
  });

  it("missing frontmatter format_version fails the version contract", () => {
    const noVersion = fixtureContent.replace("format_version: 1.0", "");
    try {
      parseRules(noVersion);
      expect.unreachable("must throw");
    } catch (err) {
      expect((err as AppError).code).toBe("FORMAT_VERSION_UNSUPPORTED");
    }
  });

  it("unsupported major version (2.0) is refused", () => {
    const bumped = fixtureContent.replace("format_version: 1.0", "format_version: 2.0");
    expect(() => parseRules(bumped)).toThrowError(AppError);
  });

  it("unknown extra fenced yaml blocks are tolerated (same-major compatibility)", () => {
    const extended = fixtureContent.concat(
      "\n## Future\n\n```yaml\nfuture_thing:\n  key: value\n```\n",
    );
    expect(() => parseRules(extended)).not.toThrow();
  });
});

describe("loadRules — from a test vault on disk", () => {
  it("loads and parses the vault's rules.md", async () => {
    const vault = await createTestVault();
    try {
      const rules = await loadRules(vault.paths.rulesPath);
      expect(rules.formatVersion).toBe("1.0");
      expect(rules.noteTypes["spec"]).toBeDefined();
    } finally {
      await vault.cleanup();
    }
  });

  it("missing file fails with an actionable error", async () => {
    try {
      await loadRules("/nonexistent/rules.md");
      expect.unreachable("must throw");
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe("RULES_PARSE_ERROR");
      expect(appErr.hint).toBeTruthy();
    }
  });
});
