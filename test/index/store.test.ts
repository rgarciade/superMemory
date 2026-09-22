import { describe, expect, it } from "vitest";
import {
  createStore,
  extractWikilinks,
  putNote,
  removeNote,
} from "../../src/index/store.js";
import type { IndexedNote } from "../../src/index/types.js";

// Task 2.1 [RED first]: the in-memory store — by-id/by-path lookup and the
// forward/backward link graph (wikilinks + spec_id), per index spec
// "Index covers properties, full text, and the link graph".

function note(overrides: Partial<IndexedNote> = {}): IndexedNote {
  return {
    id: "SPEC-search",
    type: "spec",
    title: "Search",
    path: "specs/SPEC-search-spec.md",
    tags: [],
    frontmatter: { spec_id: "SPEC-search", status: "draft" },
    body: "# Search\n\nbody text",
    wikilinks: [],
    ...overrides,
  };
}

describe("createStore", () => {
  it("starts empty", () => {
    const store = createStore();
    expect(store.byId.size).toBe(0);
    expect(store.byPath.size).toBe(0);
  });
});

describe("putNote", () => {
  it("indexes a note by id and by path", () => {
    const store = createStore();
    const spec = note();
    putNote(store, spec);
    expect(store.byId.get("SPEC-search")).toBe(spec);
    expect(store.byPath.get("specs/SPEC-search-spec.md")).toBe(spec);
  });

  it("builds forward links from wikilinks and replaces an existing entry at the same path", () => {
    const store = createStore();
    const decision = note({
      id: "DEC-1",
      type: "decision",
      path: "decisions/DEC-1-x.md",
      specId: "SPEC-search",
      wikilinks: ["SPEC-search"],
    });
    putNote(store, decision);
    expect(store.forwardLinks.get("DEC-1")).toEqual(new Set(["SPEC-search"]));
    expect(store.backwardLinks.get("SPEC-search")).toEqual(new Set(["DEC-1"]));

    // Re-putting at the same path (update) must not leave a stale duplicate.
    const updated = note({
      id: "DEC-1",
      type: "decision",
      path: "decisions/DEC-1-x.md",
      specId: "SPEC-search",
      wikilinks: [],
    });
    putNote(store, updated);
    expect(store.byId.size).toBe(1);
    expect(store.forwardLinks.get("DEC-1")).toEqual(new Set(["SPEC-search"])); // specId link retained even with no wikilinks
  });

  it("includes the note's own spec_id as a forward-link target distinct from its id", () => {
    const store = createStore();
    const incident = note({
      id: "INC-1",
      type: "incident",
      path: "incidents/INC-1-x.md",
      specId: "SPEC-search",
    });
    putNote(store, incident);
    expect(store.backwardLinks.get("SPEC-search")?.has("INC-1")).toBe(true);
  });
});

describe("removeNote", () => {
  it("drops the note and its outgoing link edges", () => {
    const store = createStore();
    const decision = note({
      id: "DEC-1",
      type: "decision",
      path: "decisions/DEC-1-x.md",
      specId: "SPEC-search",
      wikilinks: ["SPEC-search"],
    });
    putNote(store, decision);
    removeNote(store, "decisions/DEC-1-x.md");

    expect(store.byId.has("DEC-1")).toBe(false);
    expect(store.byPath.has("decisions/DEC-1-x.md")).toBe(false);
    expect(store.forwardLinks.has("DEC-1")).toBe(false);
    expect(store.backwardLinks.get("SPEC-search")?.has("DEC-1")).toBeFalsy();
  });

  it("is a no-op for a path that was never indexed", () => {
    const store = createStore();
    expect(() => removeNote(store, "nowhere.md")).not.toThrow();
    expect(store.byId.size).toBe(0);
  });
});

describe("extractWikilinks", () => {
  it("extracts plain wikilink targets, deduping repeats", () => {
    const targets = extractWikilinks(
      "See [[SPEC-search]] and again [[SPEC-search]], also [[DEC-1]].",
    );
    expect(targets).toEqual(["SPEC-search", "DEC-1"]);
  });

  it("strips pipe aliases and section anchors from the target", () => {
    const targets = extractWikilinks(
      "[[SPEC-search|the search spec]] and [[SPEC-search#Scope]].",
    );
    expect(targets).toEqual(["SPEC-search"]);
  });

  it("returns an empty array when the body has no wikilinks", () => {
    expect(extractWikilinks("plain prose, no links here")).toEqual([]);
  });
});
