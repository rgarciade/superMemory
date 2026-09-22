import { describe, expect, it } from "vitest";
import { createStore, putNote } from "../../src/index/store.js";
import { generateIndexMaps } from "../../src/index/maps.js";
import type { IndexedNote } from "../../src/index/types.js";

// Task 2.5 [RED first]: deterministic regeneration of index/ markdown maps
// (sorted, stable formatting) from the store — the committed, Obsidian-
// readable team surface (design OD-5), input for P3's chore(index) commits.

function note(overrides: Partial<IndexedNote> = {}): IndexedNote {
  return {
    id: "SPEC-a",
    type: "spec",
    title: "Spec A",
    path: "specs/a.md",
    tags: [],
    frontmatter: {},
    body: "",
    wikilinks: [],
    ...overrides,
  };
}

describe("generateIndexMaps", () => {
  it("produces one map file per note type present in the store", () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-a", type: "spec", path: "specs/a.md" }));
    putNote(
      store,
      note({ id: "DEC-1", type: "decision", path: "decisions/DEC-1.md", title: "Decision 1" }),
    );

    const maps = generateIndexMaps(store);
    const paths = maps.map((m) => m.path).sort();
    expect(paths).toEqual(["index/decision.md", "index/spec.md"]);
  });

  it("lists notes within a type map sorted by path, one entry per note", () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-z", path: "specs/z.md", title: "Z Spec" }));
    putNote(store, note({ id: "SPEC-a", path: "specs/a.md", title: "A Spec" }));

    const maps = generateIndexMaps(store);
    const specMap = maps.find((m) => m.path === "index/spec.md");
    expect(specMap).toBeDefined();
    const aIndex = specMap?.content.indexOf("A Spec") ?? -1;
    const zIndex = specMap?.content.indexOf("Z Spec") ?? -1;
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(zIndex).toBeGreaterThan(aIndex);
  });

  it("includes each note's id and status in its map entry", () => {
    const store = createStore();
    putNote(
      store,
      note({ id: "SPEC-a", path: "specs/a.md", title: "A Spec", status: "active" }),
    );

    const maps = generateIndexMaps(store);
    const specMap = maps.find((m) => m.path === "index/spec.md");
    expect(specMap?.content).toContain("SPEC-a");
    expect(specMap?.content).toContain("active");
  });

  it("is byte-identical across repeated generations (determinism)", () => {
    const store = createStore();
    putNote(store, note({ id: "SPEC-a", path: "specs/a.md" }));
    putNote(store, note({ id: "DEC-1", type: "decision", path: "decisions/DEC-1.md" }));

    const first = generateIndexMaps(store);
    const second = generateIndexMaps(store);
    expect(second).toEqual(first);
  });

  it("returns an empty array for an empty store", () => {
    const store = createStore();
    expect(generateIndexMaps(store)).toEqual([]);
  });
});
