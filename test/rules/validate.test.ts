import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { validateNote } from "../../src/rules/validate.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import { FIXTURE_VAULT_DIR } from "../helpers/create-test-vault.js";

// Task 1.11 [RED first]: validateNote — one test per rules-parsing spec
// scenario: required fields, types, enums, patterns, naming, folder.
const fixtureContent = await readFile(
  path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"),
  "utf8",
);
const rules: RulesModel = parseRules(fixtureContent);

function note(overrides: Record<string, unknown>) {
  return {
    type: "spec",
    frontmatter: {
      spec_id: "SPEC-search",
      status: "draft",
      owner: "Raul",
    },
    fileName: "SPEC-search-search-spec.md",
    folder: "specs/",
    ...overrides,
  };
}

describe("validateNote", () => {
  it("accepts a fully conforming spec note", () => {
    const issues = validateNote(rules, note({}));
    expect(issues).toEqual([]);
  });

  it("rejects a note missing a required field, naming that field", () => {
    const fm = { spec_id: "SPEC-search", status: "draft" };
    const issues = validateNote(rules, note({ frontmatter: fm }));
    expect(issues.length).toBeGreaterThan(0);
    const missing = issues.find((i) => i.field === "owner");
    expect(missing?.kind).toBe("field");
    expect(missing?.message).toContain("owner");
    expect(missing?.message).toMatch(/required/i);
  });

  it("rejects an enum violation naming the allowed values", () => {
    const issues = validateNote(
      rules,
      note({ frontmatter: { spec_id: "SPEC-search", status: "bogus", owner: "R" } }),
    );
    const status = issues.find((i) => i.field === "status");
    expect(status?.kind).toBe("enum");
    expect(status?.message).toContain("draft");
    expect(status?.message).toContain("deprecated");
  });

  it("rejects a pattern violation naming the field and its pattern", () => {
    const issues = validateNote(
      rules,
      note({ frontmatter: { spec_id: "SPEC Bad!", status: "draft", owner: "R" } }),
    );
    const pattern = issues.find((i) => i.field === "spec_id");
    expect(pattern?.kind).toBe("pattern");
    expect(pattern?.message).toContain("SPEC-[a-z0-9-]+");
  });

  it("rejects a wrong-typed field (string expected, number given)", () => {
    const issues = validateNote(
      rules,
      note({ frontmatter: { spec_id: 42, status: "draft", owner: "R" } }),
    );
    const typed = issues.find((i) => i.field === "spec_id");
    expect(typed?.kind).toBe("field");
  });

  it("rejects a date field that is not date-shaped", () => {
    const issues = validateNote(
      rules,
      note({
        frontmatter: {
          spec_id: "SPEC-search",
          status: "draft",
          owner: "R",
          review_after: "not-a-date",
        },
      }),
    );
    const date = issues.find((i) => i.field === "review_after");
    expect(date?.kind).toBe("field");
    expect(date?.message).toMatch(/date/i);
  });

  it("rejects a naming mismatch", () => {
    const issues = validateNote(
      rules,
      note({ fileName: "wrong-name.md" }),
    );
    const naming = issues.find((i) => i.kind === "naming");
    expect(naming).toBeDefined();
    expect(naming?.message).toContain("{spec_id}-{slug}.md");
  });

  it("rejects a note placed in the wrong folder", () => {
    const issues = validateNote(rules, note({ folder: "decisions/" }));
    const folder = issues.find((i) => i.kind === "folder");
    expect(folder).toBeDefined();
    expect(folder?.message).toContain("specs/");
  });

  it("rejects an undeclared note type", () => {
    const issues = validateNote(
      rules,
      note({ type: "mystery", folder: "anywhere/" }),
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.message).toContain("mystery");
  });

  it("skips naming validation when the type declares no naming pattern", () => {
    const issues = validateNote(rules, {
      type: "session_log",
      frontmatter: { date: "2025-06-01", actor: "agent" },
      fileName: "anything-goes.md",
      folder: "logs/",
    });
    expect(issues).toEqual([]);
  });

  it("accepts a date field gray-matter parsed as a JS Date (unquoted YAML date, e.g. from the shipped template)", () => {
    // `date: 2026-09-22` with no quotes is valid YAML and gray-matter's
    // parser turns it into a real Date, not a string — the same shape a
    // note rendered from the shipped template produces once saved and
    // re-parsed.
    const { data } = matter("---\ndate: 2026-09-22\nactor: agent\n---\n\nbody\n");
    expect(data["date"]).toBeInstanceOf(Date);

    const issues = validateNote(rules, {
      type: "session_log",
      frontmatter: data,
      fileName: "anything-goes.md",
      folder: "logs/",
    });
    expect(issues).toEqual([]);
  });

  it("rejects an invalid Date instance for a date field", () => {
    const issues = validateNote(rules, {
      type: "session_log",
      frontmatter: { date: new Date(Number.NaN), actor: "agent" },
      fileName: "anything-goes.md",
      folder: "logs/",
    });
    const date = issues.find((i) => i.field === "date");
    expect(date?.kind).toBe("field");
    expect(date?.message).toMatch(/date/i);
  });

  it("optional fields may be absent without violation", () => {
    const issues = validateNote(
      rules,
      note({
        frontmatter: {
          spec_id: "SPEC-search",
          status: "active",
          owner: "R",
          review_after: "2026-01-01",
        },
      }),
    );
    expect(issues).toEqual([]);
  });
});
