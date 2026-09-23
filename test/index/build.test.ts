import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildIndex, buildIndexedNote, parseNoteAt, resolveNoteType } from "../../src/index/build.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import { createTestVault } from "../helpers/create-test-vault.js";

// Task 2.2 [RED first]: buildIndex — vault walk + gray-matter parse into a
// populated in-memory store (design OD-5, index spec: "built in memory at
// startup by walking the vault").

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
Full-text search over the vault.

## Linked Knowledge
`;

const DECISION_NOTE = `---
decision_id: DEC-1
spec_id: SPEC-search
status: proposed
---

# Use an in-memory index

Links back to [[SPEC-search]].
`;

const INCIDENT_NOTE = `---
incident_id: INC-1
spec_id: SPEC-search
status: open
---

# Search returned stale results
`;

const SESSION_LOG_NOTE = `---
date: 2026-01-01
actor: agent
---

# Session 2026-01-01

## Notes

- did some work
`;

describe("buildIndex", () => {
  it("walks the vault and populates the store from declared note-type folders", async () => {
    const vault = await createTestVault({
      seedNotes: [
        { path: "specs/SPEC-search-spec.md", content: SPEC_NOTE },
        { path: "decisions/DEC-1-index.md", content: DECISION_NOTE },
        { path: "incidents/INC-1-stale.md", content: INCIDENT_NOTE },
        { path: "logs/2026-01-01.md", content: SESSION_LOG_NOTE },
      ],
    });
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);

      const spec = store.byId.get("SPEC-search");
      expect(spec?.type).toBe("spec");
      expect(spec?.title).toBe("Search spec");
      expect(spec?.path).toBe("specs/SPEC-search-spec.md");

      const decision = store.byId.get("DEC-1");
      expect(decision?.type).toBe("decision");
      expect(decision?.specId).toBe("SPEC-search");
      expect(decision?.wikilinks).toEqual(["SPEC-search"]);

      const incident = store.byId.get("INC-1");
      expect(incident?.type).toBe("incident");

      // session_log declares no id field — falls back to its own path.
      const log = store.byId.get("logs/2026-01-01.md");
      expect(log?.type).toBe("session_log");

      expect(store.byId.size).toBe(4);
    } finally {
      await vault.cleanup();
    }
  });

  it("writes no index artifact anywhere and leaves git status clean", async () => {
    const vault = await createTestVault({
      seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
    });
    try {
      const rules = await loadRules(vault.root);
      await buildIndex(vault.root, rules);

      const status = await vault.git.status();
      expect(status.isClean()).toBe(true);
    } finally {
      await vault.cleanup();
    }
  });

  it("restart identity: two builds over the same vault yield identical query results", async () => {
    const vault = await createTestVault({
      seedNotes: [
        { path: "specs/SPEC-search-spec.md", content: SPEC_NOTE },
        { path: "decisions/DEC-1-index.md", content: DECISION_NOTE },
      ],
    });
    try {
      const rules = await loadRules(vault.root);
      const first = await buildIndex(vault.root, rules);
      const second = await buildIndex(vault.root, rules);

      expect([...second.byId.keys()].sort()).toEqual([...first.byId.keys()].sort());
      expect(second.byId.get("DEC-1")?.title).toBe(first.byId.get("DEC-1")?.title);
      expect(second.byId.get("DEC-1")?.specId).toBe(first.byId.get("DEC-1")?.specId);
    } finally {
      await vault.cleanup();
    }
  });

  it("does not corrupt the index when two files declare the same id (e.g. a pull landing a duplicate) — first file wins deterministically, no crash", async () => {
    const vault = await createTestVault({
      seedNotes: [
        { path: "decisions/DEC-1-a.md", content: DECISION_NOTE },
        {
          path: "decisions/DEC-1-b.md",
          content: DECISION_NOTE.replace("Use an in-memory index", "A different, colliding decision"),
        },
      ],
    });
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);

      // Deterministic: listMarkdownFiles sorts paths, so "a.md" is parsed
      // first and wins the id slot; "b.md" is rejected by putNote, never
      // silently corrupting "a.md"'s entry.
      expect(store.byId.size).toBe(1);
      expect(store.byId.get("DEC-1")?.path).toBe("decisions/DEC-1-a.md");
      expect(store.byId.get("DEC-1")?.title).toBe("Use an in-memory index");
      expect(store.byPath.has("decisions/DEC-1-a.md")).toBe(true);
      expect(store.byPath.has("decisions/DEC-1-b.md")).toBe(false);
    } finally {
      await vault.cleanup();
    }
  });

  it("ignores non-note folders such as .memory/templates and index/", async () => {
    const vault = await createTestVault({
      seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
    });
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);
      // Only the one seeded spec — templates/.gitkeep files never become notes.
      expect(store.byId.size).toBe(1);
    } finally {
      await vault.cleanup();
    }
  });
});

describe("resolveNoteType", () => {
  it("resolves the declared type owning a given relative path", async () => {
    const vault = await createTestVault();
    try {
      const rules = await loadRules(vault.root);
      const resolved = resolveNoteType("decisions/DEC-1-index.md", rules);
      expect(resolved?.type).toBe("decision");
    } finally {
      await vault.cleanup();
    }
  });

  it("returns undefined for a path outside every declared folder", async () => {
    const vault = await createTestVault();
    try {
      const rules = await loadRules(vault.root);
      expect(resolveNoteType("conflicts/2026-01-01-x.md", rules)).toBeUndefined();
    } finally {
      await vault.cleanup();
    }
  });
});

describe("parseNoteAt", () => {
  it("parses a single file into an IndexedNote", async () => {
    const vault = await createTestVault({
      seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
    });
    try {
      const rules = await loadRules(vault.root);
      const def = rules.noteTypes["spec"];
      if (!def) throw new Error("fixture rules must declare a spec type");
      const note = await parseNoteAt(vault.root, "specs/SPEC-search-spec.md", "spec", def);
      expect(note.id).toBe("SPEC-search");
      expect(note.title).toBe("Search spec");
      expect(note.status).toBe("draft");
    } finally {
      await vault.cleanup();
    }
  });
});

// Second re-review: buildIndexedNote is the pure core parseNoteAt reads a
// file then delegates to — extracted so notes/save-pipeline.ts can build
// an IndexedNote synchronously from already-in-memory content during a
// move (no disk re-read, no await between removeNote and putNote).
describe("buildIndexedNote", () => {
  it("builds the same IndexedNote shape parseNoteAt produces, from already-parsed parts", async () => {
    const vault = await createTestVault({
      seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
    });
    try {
      const rules = await loadRules(vault.root);
      const def = rules.noteTypes["spec"];
      if (!def) throw new Error("fixture rules must declare a spec type");

      const viaFile = await parseNoteAt(vault.root, "specs/SPEC-search-spec.md", "spec", def);
      const viaPure = buildIndexedNote(
        "spec",
        "specs/SPEC-search-spec.md",
        viaFile.frontmatter,
        viaFile.body,
        def,
      );
      expect(viaPure).toEqual(viaFile);
    } finally {
      await vault.cleanup();
    }
  });
});
