import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  classifyConflictPath,
  normalizeSessionLog,
  planConflictLadder,
  resolveUnionConflict,
} from "../../src/sync/ladder.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import { FIXTURE_VAULT_DIR } from "../helpers/create-test-vault.js";

// Task 3.5 [RED first]: ladder.ts — pure conflict classification from
// RulesModel + config and whole-rebase routing (design §4.4): generated →
// take-theirs + continue + deterministic regeneration; union →
// concatenation + normalization; ANY curated conflict routes the entire
// rebase to the curated (abort/snapshot/conflict-note) path.

async function loadRules(): Promise<RulesModel> {
  const raw = await readFile(path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

describe("classifyConflictPath", () => {
  it("classifies generated / union / curated paths from the fixture rules", async () => {
    const rules = await loadRules();
    expect(classifyConflictPath("index/spec.md", rules)).toBe("generated");
    expect(classifyConflictPath(".memory/cache/derived.dat", rules)).toBe("generated");
    expect(classifyConflictPath("logs/2026-07-14.md", rules)).toBe("union");
    expect(classifyConflictPath("specs/SPEC-search.md", rules)).toBe("curated");
    expect(classifyConflictPath("decisions/DEC-0042-x.md", rules)).toBe("curated");
    expect(classifyConflictPath("unmapped/whatever.md", rules)).toBe("curated");
  });

  it("defaults generated paths to index/ when rules declare none", async () => {
    const rules = await loadRules();
    const withoutGenerated: RulesModel = {
      ...rules,
      git: { ...rules.git, generatedPaths: undefined },
    };
    expect(classifyConflictPath("index/spec.md", withoutGenerated)).toBe("generated");
    expect(classifyConflictPath(".memory/cache/derived.dat", withoutGenerated)).toBe("curated");
  });

  it("resolves the union policy per type: explicit conflict_policy beats conflict_policy_defaults", async () => {
    const rules = await loadRules();
    const overridden: RulesModel = {
      ...rules,
      noteTypes: {
        ...rules.noteTypes,
        spec: { ...rules.noteTypes["spec"]!, conflictPolicy: "union" },
        // session_log keeps its explicit `union` — prove it wins over a
        // non-union default for the same name.
      },
      conflictPolicyDefaults: { ...rules.conflictPolicyDefaults, session_log: "human_required" },
    };
    expect(classifyConflictPath("specs/SPEC-a.md", overridden)).toBe("union");
    expect(classifyConflictPath("logs/2026-07-14.md", overridden)).toBe("union");
  });

  it("falls back to conflict_policy_defaults[type] when the type declares no policy", async () => {
    const rules = await loadRules();
    const defaulted: RulesModel = {
      ...rules,
      noteTypes: {
        ...rules.noteTypes,
        spec: { ...rules.noteTypes["spec"]!, conflictPolicy: undefined },
      },
      conflictPolicyDefaults: { spec: "union" },
    };
    expect(classifyConflictPath("specs/SPEC-a.md", defaulted)).toBe("union");
  });
});

describe("planConflictLadder — routing", () => {
  it("all generated → auto: take either side, continue, regenerate deterministically", async () => {
    const rules = await loadRules();
    const decision = planConflictLadder(["index/spec.md", "index/decision.md"], rules);
    expect(decision.action).toBe("auto");
    expect(decision.byCategory.generated).toEqual(["index/spec.md", "index/decision.md"]);
    expect(decision.byCategory.union).toEqual([]);
    expect(decision.byCategory.curated).toEqual([]);
    expect(decision.curatedPaths).toEqual([]);
  });

  it("all union → auto: union concatenation + normalization", async () => {
    const rules = await loadRules();
    const decision = planConflictLadder(["logs/2026-07-14.md"], rules);
    expect(decision.action).toBe("auto");
    expect(decision.byCategory.union).toEqual(["logs/2026-07-14.md"]);
    expect(decision.curatedPaths).toEqual([]);
  });

  it("mixed generated + union (no curated) → auto: every conflict is auto-resolvable", async () => {
    const rules = await loadRules();
    const decision = planConflictLadder(["index/spec.md", "logs/2026-07-14.md"], rules);
    expect(decision.action).toBe("auto");
    expect(decision.byCategory.generated).toEqual(["index/spec.md"]);
    expect(decision.byCategory.union).toEqual(["logs/2026-07-14.md"]);
  });

  it("ANY curated conflict routes the whole rebase to the curated path", async () => {
    const rules = await loadRules();
    const decision = planConflictLadder(
      ["index/spec.md", "logs/2026-07-14.md", "specs/SPEC-search.md", "decisions/DEC-1.md"],
      rules,
    );
    expect(decision.action).toBe("curated-abort");
    expect(decision.curatedPaths).toEqual(["specs/SPEC-search.md", "decisions/DEC-1.md"]);
    // The auto categories are still classified (for the report), but the
    // action is curated — half a rebase is never auto-resolved.
    expect(decision.byCategory.generated).toEqual(["index/spec.md"]);
    expect(decision.byCategory.union).toEqual(["logs/2026-07-14.md"]);
  });

  it("a single curated conflict alone also routes to curated-abort", async () => {
    const rules = await loadRules();
    expect(planConflictLadder(["specs/SPEC-search.md"], rules).action).toBe("curated-abort");
  });

  it("an empty conflict list is auto with nothing to do", async () => {
    const rules = await loadRules();
    const decision = planConflictLadder([], rules);
    expect(decision.action).toBe("auto");
    expect(decision.curatedPaths).toEqual([]);
  });
});

describe("resolveUnionConflict — marker-level union failure", () => {
  it("takes BOTH regions (concatenation) and drops the conflict markers", () => {
    const conflicted = [
      "# Session 2026-07-14",
      "",
      "## Notes",
      "",
      "- 2026-07-14T10:00:00Z | e-001 | local entry",
      "<<<<<<< HEAD",
      "- 2026-07-14T10:05:00Z | e-002 | local only",
      "=======",
      "- 2026-07-14T10:06:00Z | e-003 | remote only",
      ">>>>>>> origin/main",
    ].join("\n");
    const resolved = resolveUnionConflict(conflicted);
    expect(resolved).not.toContain("<<<<<<<");
    expect(resolved).not.toContain("=======");
    expect(resolved).not.toContain(">>>>>>>");
    expect(resolved).toContain("- 2026-07-14T10:05:00Z | e-002 | local only");
    expect(resolved).toContain("- 2026-07-14T10:06:00Z | e-003 | remote only");
    // Local region precedes the remote region (deterministic order before
    // the normalizer canonicalizes).
    expect(resolved.indexOf("e-002")).toBeLessThan(resolved.indexOf("e-003"));
  });
});

describe("normalizeSessionLog — sort by timestamp, dedupe by entry id", () => {
  const LOG = [
    "---",
    "date: 2026-07-14",
    "actor: agent",
    "---",
    "",
    "# Session 2026-07-14",
    "",
    "## Notes",
    "",
    "- 2026-07-14T10:06:00Z | e-003 | third entry",
    "- 2026-07-14T10:00:00Z | e-001 | first entry",
    "- 2026-07-14T10:03:00Z | e-002 | second entry",
  ].join("\n");

  it("sorts entries chronologically and preserves every non-entry line", () => {
    const normalized = normalizeSessionLog(LOG);
    const lines = normalized.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines[3]).toBe("---");
    expect(lines[5]).toBe("# Session 2026-07-14");
    expect(lines[7]).toBe("## Notes");
    const entries = lines.filter((l) => l.startsWith("- "));
    expect(entries.map((e) => e.match(/\| (e-\d+) \|/)?.[1])).toEqual(["e-001", "e-002", "e-003"]);
  });

  it("dedupes by entry id — the first occurrence wins, nothing else is lost", () => {
    const unioned = [
      "# Session 2026-07-14",
      "",
      "## Notes",
      "",
      "- 2026-07-14T10:00:00Z | e-001 | local version of first",
      "- 2026-07-14T10:05:00Z | e-002 | local only",
      "- 2026-07-14T10:00:00Z | e-001 | remote duplicate of first",
      "- 2026-07-14T10:06:00Z | e-003 | remote only",
    ].join("\n");
    const normalized = normalizeSessionLog(unioned);
    expect(normalized.match(/e-001/g)).toHaveLength(1);
    expect(normalized).toContain("local version of first");
    expect(normalized).toContain("local only");
    expect(normalized).toContain("remote only");
  });

  it("keeps first-seen order for equal timestamps (stable sort)", () => {
    const unioned = [
      "- 2026-07-14T10:00:00Z | a-first | seen first",
      "- 2026-07-14T10:00:00Z | b-second | seen second",
    ].join("\n");
    const normalized = normalizeSessionLog(unioned);
    expect(normalized.indexOf("a-first")).toBeLessThan(normalized.indexOf("b-second"));
  });

  it("sorts entries with unparsable timestamps after dated ones, without dropping them", () => {
    const unioned = [
      "- 2026-07-14T10:02:00Z | dated | dated entry",
      "- not-a-timestamp | undated | undated entry",
    ].join("\n");
    const normalized = normalizeSessionLog(unioned);
    expect(normalized.indexOf("dated entry")).toBeLessThan(normalized.indexOf("undated entry"));
  });

  it("is idempotent: normalizing twice yields the same bytes", () => {
    const once = normalizeSessionLog(LOG);
    expect(normalizeSessionLog(once)).toBe(once);
  });

  it("leaves content with no entries byte-identical", () => {
    const prose = "# Session\n\nJust prose, no entries.\n";
    expect(normalizeSessionLog(prose)).toBe(prose);
  });
});
