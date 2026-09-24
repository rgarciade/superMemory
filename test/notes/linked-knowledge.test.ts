import { describe, expect, it } from "vitest";
import { appendLinkedKnowledgeEntry } from "../../src/notes/linked-knowledge.js";

// Task 2.7 [RED first]: spec hub Linked Knowledge section maintenance —
// appended on create, idempotent entries keyed by note id (save requirement:
// "repeated saves of the same note MUST NOT create duplicate entries").

const SPEC_BODY = `# Search spec

## Purpose
Full-text search over the vault.

## Linked Knowledge

Auto-maintained index of decisions, incidents, and learnings that
reference this spec.
`;

const entry = {
  id: "DEC-1",
  type: "decision",
  title: "Use an in-memory index",
  path: "decisions/DEC-1-index.md",
};

describe("appendLinkedKnowledgeEntry", () => {
  it("appends an entry under the Linked Knowledge heading", () => {
    const updated = appendLinkedKnowledgeEntry(SPEC_BODY, entry);
    expect(updated).toContain("## Linked Knowledge");
    expect(updated).toContain("Use an in-memory index");
    expect(updated).toContain("decisions/DEC-1-index.md");
    // Still inside/after the heading, not before the Purpose section.
    expect(updated.indexOf("## Linked Knowledge")).toBeLessThan(
      updated.indexOf("Use an in-memory index"),
    );
  });

  it("is idempotent — saving the same note twice does not duplicate the entry", () => {
    const once = appendLinkedKnowledgeEntry(SPEC_BODY, entry);
    const twice = appendLinkedKnowledgeEntry(once, entry);
    const occurrences = twice.split("DEC-1-index.md").length - 1;
    expect(occurrences).toBe(1);
  });

  it("adds a second, distinct entry alongside the first", () => {
    const once = appendLinkedKnowledgeEntry(SPEC_BODY, entry);
    const withSecond = appendLinkedKnowledgeEntry(once, {
      id: "INC-1",
      type: "incident",
      title: "Search returned stale results",
      path: "incidents/INC-1-stale.md",
    });
    expect(withSecond).toContain("decisions/DEC-1-index.md");
    expect(withSecond).toContain("incidents/INC-1-stale.md");
  });

  it("creates a Linked Knowledge section when the body has none", () => {
    const bodyWithoutSection = "# A note\n\nJust prose, no section.\n";
    const updated = appendLinkedKnowledgeEntry(bodyWithoutSection, entry);
    expect(updated).toContain("## Linked Knowledge");
    expect(updated).toContain("decisions/DEC-1-index.md");
    expect(updated.indexOf("## Linked Knowledge")).toBeGreaterThan(
      updated.indexOf("Just prose"),
    );
  });

  it("preserves existing prose in the Linked Knowledge section", () => {
    const updated = appendLinkedKnowledgeEntry(SPEC_BODY, entry);
    expect(updated).toContain(
      "Auto-maintained index of decisions, incidents, and learnings",
    );
  });
});
