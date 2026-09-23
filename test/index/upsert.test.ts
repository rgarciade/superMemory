import { describe, expect, it } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildIndex } from "../../src/index/build.js";
import { reparseFiles, upsertNote } from "../../src/index/upsert.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import { createTestVault } from "../helpers/create-test-vault.js";

// Task 2.3 [RED first]: incremental update without a full rebuild (index
// spec: "the system SHALL reflect the change without a full rebuild").

async function loadRules(vaultRoot: string): Promise<RulesModel> {
  const raw = await readFile(path.join(vaultRoot, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

const SPEC_NOTE = `---
spec_id: SPEC-search
status: draft
owner: Raul
---

# Search spec

## Purpose
Full-text search.
`;

const DECISION_NOTE = `---
decision_id: DEC-1
spec_id: SPEC-search
status: proposed
---

# Use an in-memory index
`;

describe("upsertNote", () => {
  it("makes a newly saved note immediately visible without a rebuild", async () => {
    const vault = await createTestVault({
      seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
    });
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);
      expect(store.byId.has("DEC-1")).toBe(false);

      await vault.write("decisions/DEC-1-index.md", DECISION_NOTE);
      await upsertNote(store, vault.root, "decisions/DEC-1-index.md", rules);

      const decision = store.byId.get("DEC-1");
      expect(decision?.type).toBe("decision");
      expect(decision?.specId).toBe("SPEC-search");
    } finally {
      await vault.cleanup();
    }
  });

  it("re-parses an updated note in place, reflecting the new content", async () => {
    const vault = await createTestVault({
      seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
    });
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);
      expect(store.byId.get("SPEC-search")?.status).toBe("draft");

      const updated = SPEC_NOTE.replace("status: draft", "status: active");
      await writeFile(path.join(vault.root, "specs/SPEC-search-spec.md"), updated, "utf8");
      await upsertNote(store, vault.root, "specs/SPEC-search-spec.md", rules);

      expect(store.byId.get("SPEC-search")?.status).toBe("active");
    } finally {
      await vault.cleanup();
    }
  });

  it("drops a note and its link edges when the file no longer exists on disk", async () => {
    const vault = await createTestVault({
      seedNotes: [
        { path: "specs/SPEC-search-spec.md", content: SPEC_NOTE },
        { path: "decisions/DEC-1-index.md", content: DECISION_NOTE },
      ],
    });
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);
      expect(store.byId.has("DEC-1")).toBe(true);
      expect(store.backwardLinks.get("SPEC-search")?.has("DEC-1")).toBe(true);

      await rm(path.join(vault.root, "decisions/DEC-1-index.md"));
      await upsertNote(store, vault.root, "decisions/DEC-1-index.md", rules);

      expect(store.byId.has("DEC-1")).toBe(false);
      expect(store.backwardLinks.get("SPEC-search")?.has("DEC-1")).toBeFalsy();
    } finally {
      await vault.cleanup();
    }
  });

  // Second re-review, NEW-1: upsertNote previously ignored putNote's
  // rejection entirely, silently reporting success while the file was
  // never actually indexed. It must now propagate the rejection so the
  // caller can fail loudly instead of lying about success.
  it("propagates putNote's rejection instead of silently succeeding when a genuine id collision reaches it (e.g. a pull landing a duplicate)", async () => {
    const vault = await createTestVault({
      seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
    });
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);
      const original = store.byId.get("SPEC-search");
      expect(original?.path).toBe("specs/SPEC-search-spec.md");

      // A second file lands (e.g. via a pull) declaring the SAME spec_id
      // at a genuinely different path — not a move, a true duplicate.
      await vault.write("specs/SPEC-search-spec-duplicate.md", SPEC_NOTE);
      const result = await upsertNote(
        store,
        vault.root,
        "specs/SPEC-search-spec-duplicate.md",
        rules,
      );

      expect(result).toEqual({ ok: false, conflictingPath: "specs/SPEC-search-spec.md" });
      // The original stays exactly as it was — no corruption.
      expect(store.byId.get("SPEC-search")).toBe(original);
      expect(store.byPath.has("specs/SPEC-search-spec-duplicate.md")).toBe(false);
    } finally {
      await vault.cleanup();
    }
  });

  it("returns { ok: true } for a normal, successful upsert", async () => {
    const vault = await createTestVault({
      seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
    });
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);
      await vault.write("decisions/DEC-1-index.md", DECISION_NOTE);
      const result = await upsertNote(store, vault.root, "decisions/DEC-1-index.md", rules);
      expect(result).toEqual({ ok: true });
    } finally {
      await vault.cleanup();
    }
  });

  it("is a no-op for a path outside every declared note-type folder", async () => {
    const vault = await createTestVault({
      seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
    });
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);
      const sizeBefore = store.byId.size;

      await upsertNote(store, vault.root, "conflicts/2026-01-01-x.md", rules);

      expect(store.byId.size).toBe(sizeBefore);
    } finally {
      await vault.cleanup();
    }
  });
});

describe("reparseFiles", () => {
  it("re-parses only the named changed files, leaving unchanged notes untouched", async () => {
    const vault = await createTestVault({
      seedNotes: [
        { path: "specs/SPEC-search-spec.md", content: SPEC_NOTE },
        { path: "decisions/DEC-1-index.md", content: DECISION_NOTE },
      ],
    });
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);
      const untouchedBefore = store.byId.get("SPEC-search");

      // Simulate a post-pull change: only the decision file changed.
      const updatedDecision = DECISION_NOTE.replace("status: proposed", "status: accepted");
      await writeFile(
        path.join(vault.root, "decisions/DEC-1-index.md"),
        updatedDecision,
        "utf8",
      );
      await reparseFiles(store, vault.root, rules, ["decisions/DEC-1-index.md"]);

      expect(store.byId.get("DEC-1")?.status).toBe("accepted");
      // Unchanged note is the exact same object — proof it was not re-read.
      expect(store.byId.get("SPEC-search")).toBe(untouchedBefore);
    } finally {
      await vault.cleanup();
    }
  });

  it("adds a new note and removes a deleted note in the same call", async () => {
    const vault = await createTestVault({
      seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
    });
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);

      await vault.write("decisions/DEC-1-index.md", DECISION_NOTE);
      await rm(path.join(vault.root, "specs/SPEC-search-spec.md"));

      await reparseFiles(store, vault.root, rules, [
        "decisions/DEC-1-index.md",
        "specs/SPEC-search-spec.md",
      ]);

      expect(store.byId.has("DEC-1")).toBe(true);
      expect(store.byId.has("SPEC-search")).toBe(false);
    } finally {
      await vault.cleanup();
    }
  });
});
