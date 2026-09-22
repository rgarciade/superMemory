import { describe, expect, it } from "vitest";
import { createStore, putNote } from "../../src/index/store.js";
import { backlinks, findNotes } from "../../src/index/queries.js";
import type { IndexedNote } from "../../src/index/types.js";

// Task 2.4 [RED first]: queries.ts — the only query surface (design OD-5):
// property filters, free-text search, combined filter+text, backlinks,
// deterministic ordering, default limit 20.

function note(overrides: Partial<IndexedNote> = {}): IndexedNote {
  return {
    id: "SPEC-search",
    type: "spec",
    title: "Search spec",
    path: "specs/SPEC-search-spec.md",
    tags: [],
    frontmatter: {},
    body: "prose",
    wikilinks: [],
    ...overrides,
  };
}

describe("findNotes — property filters", () => {
  it("returns only notes matching a status filter", () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-a", path: "specs/a.md", status: "active" }));
    putNote(store, note({ id: "SPEC-b", path: "specs/b.md", status: "draft" }));

    const results = findNotes(store, { status: "active" });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: "SPEC-a",
      title: "Search spec",
      status: "active",
      path: "specs/a.md",
      type: "spec",
    });
  });

  it("filters by type, spec_id, owner, and tags together (AND)", () => {
    const store = createStore();
    putNote(
      store,
      note({
        id: "DEC-1",
        type: "decision",
        path: "decisions/DEC-1.md",
        specId: "SPEC-a",
        owner: "raul",
        tags: ["core", "index"],
      }),
    );
    putNote(
      store,
      note({
        id: "DEC-2",
        type: "decision",
        path: "decisions/DEC-2.md",
        specId: "SPEC-a",
        owner: "other",
        tags: ["core"],
      }),
    );

    const results = findNotes(store, {
      type: "decision",
      specId: "SPEC-a",
      owner: "raul",
      tags: ["core", "index"],
    });
    expect(results.map((r) => r.id)).toEqual(["DEC-1"]);
  });

  it("filters by a date range on a named frontmatter field", () => {
    const store = createStore();
    putNote(
      store,
      note({
        id: "SPEC-early",
        path: "specs/early.md",
        frontmatter: { review_after: "2026-01-01" },
      }),
    );
    putNote(
      store,
      note({
        id: "SPEC-late",
        path: "specs/late.md",
        frontmatter: { review_after: "2026-12-01" },
      }),
    );

    const results = findNotes(store, {
      dateField: "review_after",
      dateFrom: new Date("2026-06-01"),
    });
    expect(results.map((r) => r.id)).toEqual(["SPEC-late"]);
  });
});

describe("findNotes — free text", () => {
  it("hits a term appearing in the note body", () => {
    const store = createStore();
    putNote(
      store,
      note({
        id: "SPEC-a",
        path: "specs/a.md",
        body: "This spec covers full-text search over the vault.",
      }),
    );
    putNote(store, note({ id: "SPEC-b", path: "specs/b.md", body: "unrelated content" }));

    const results = findNotes(store, { text: "full-text search" });
    expect(results.map((r) => r.id)).toEqual(["SPEC-a"]);
  });

  it("combines a property filter with free text — filters narrow first", () => {
    const store = createStore();
    putNote(
      store,
      note({
        id: "SPEC-a",
        path: "specs/a.md",
        status: "active",
        body: "mentions search",
      }),
    );
    putNote(
      store,
      note({
        id: "SPEC-b",
        path: "specs/b.md",
        status: "draft",
        body: "mentions search",
      }),
    );

    const results = findNotes(store, { status: "active", text: "search" });
    expect(results.map((r) => r.id)).toEqual(["SPEC-a"]);
  });
});

describe("findNotes — ordering and limit", () => {
  it("returns results in a deterministic order across repeated calls", () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-z", path: "specs/z.md" }));
    putNote(store, note({ id: "SPEC-a", path: "specs/a.md" }));
    putNote(store, note({ id: "SPEC-m", path: "specs/m.md" }));

    const first = findNotes(store).map((r) => r.path);
    const second = findNotes(store).map((r) => r.path);
    expect(first).toEqual(["specs/a.md", "specs/m.md", "specs/z.md"]);
    expect(second).toEqual(first);
  });

  it("defaults to a limit of 20 results", () => {
    const store = createStore();
    for (let i = 0; i < 25; i += 1) {
      const idx = String(i).padStart(2, "0");
      putNote(store, note({ id: `SPEC-${idx}`, path: `specs/${idx}.md` }));
    }
    expect(findNotes(store)).toHaveLength(20);
  });

  it("honors an explicit limit override", () => {
    const store = createStore();
    for (let i = 0; i < 5; i += 1) {
      putNote(store, note({ id: `SPEC-${i}`, path: `specs/${i}.md` }));
    }
    expect(findNotes(store, { limit: 2 })).toHaveLength(2);
  });
});

describe("backlinks", () => {
  it("returns notes linking to a target via wikilinks and spec_id, deterministically ordered", () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-a", path: "specs/a.md" }));
    putNote(
      store,
      note({
        id: "DEC-2",
        type: "decision",
        path: "decisions/DEC-2.md",
        specId: "SPEC-a",
      }),
    );
    putNote(
      store,
      note({
        id: "DEC-1",
        type: "decision",
        path: "decisions/DEC-1.md",
        wikilinks: ["SPEC-a"],
      }),
    );

    const results = backlinks(store, "SPEC-a");
    expect(results.map((r) => r.id)).toEqual(["DEC-1", "DEC-2"]); // sorted by path
  });

  it("returns an empty array for a target with no backlinks", () => {
    const store = createStore();
    putNote(store, note());
    expect(backlinks(store, "NOTHING-LINKS-HERE")).toEqual([]);
  });
});
