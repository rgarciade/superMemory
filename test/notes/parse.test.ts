import { describe, expect, it } from "vitest";
import {
  deriveNoteId,
  deriveTitle,
  parseNoteFile,
} from "../../src/notes/parse.js";
import type { NoteTypeDef } from "../../src/rules/types.js";

// Task 2.6 [RED first]: gray-matter parse + deterministic id/title
// derivation, shared by save, grammar (P3), and the index (design §4.3).

describe("parseNoteFile", () => {
  it("splits frontmatter from the body", () => {
    const raw = "---\nspec_id: SPEC-search\nstatus: draft\n---\n\n# Search\n\nbody text\n";
    const { frontmatter, body } = parseNoteFile(raw);
    expect(frontmatter["spec_id"]).toBe("SPEC-search");
    expect(frontmatter["status"]).toBe("draft");
    expect(body).toContain("# Search");
    expect(body).toContain("body text");
  });

  it("returns an empty frontmatter object when there is none", () => {
    const { frontmatter, body } = parseNoteFile("# Just prose\n");
    expect(frontmatter).toEqual({});
    expect(body).toContain("Just prose");
  });
});

describe("deriveTitle", () => {
  it("prefers the first `#` heading in the body", () => {
    const title = deriveTitle(
      "# Search spec\n\nsome content",
      { title: "Frontmatter title" },
      "SPEC-search-spec.md",
    );
    expect(title).toBe("Search spec");
  });

  it("falls back to a `title` frontmatter field when the body has no heading", () => {
    const title = deriveTitle(
      "no heading here",
      { title: "Explicit Title" },
      "SPEC-search-spec.md",
    );
    expect(title).toBe("Explicit Title");
  });

  it("falls back to a filename-derived slug when neither is present", () => {
    const title = deriveTitle("no heading, no frontmatter title", {}, "spec-search-notes.md");
    expect(title).toBe("Spec Search Notes");
  });

  it("ignores a non-string `title` frontmatter value", () => {
    const title = deriveTitle("no heading", { title: 42 }, "fallback-name.md");
    expect(title).toBe("Fallback Name");
  });
});

describe("deriveNoteId", () => {
  it("uses the note type's explicit id_field when declared", () => {
    const def: NoteTypeDef = { folder: "specs/", frontmatter: {}, idField: "custom_id" };
    const id = deriveNoteId("spec", { custom_id: "X-1", spec_id: "SPEC-x" }, def);
    expect(id).toBe("X-1");
  });

  it("falls back to `<type>_id` from frontmatter when no id_field is declared", () => {
    const def: NoteTypeDef = { folder: "decisions/", frontmatter: {} };
    const id = deriveNoteId("decision", { decision_id: "DEC-1" }, def);
    expect(id).toBe("DEC-1");
  });

  it("returns undefined when the resolved id field is absent (e.g. session logs)", () => {
    const def: NoteTypeDef = { folder: "logs/", frontmatter: {} };
    const id = deriveNoteId("session_log", { date: "2026-01-01", actor: "agent" }, def);
    expect(id).toBeUndefined();
  });

  it("works without a NoteTypeDef, falling back to `<type>_id`", () => {
    const id = deriveNoteId("incident", { incident_id: "INC-9" }, undefined);
    expect(id).toBe("INC-9");
  });
});
