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

  // Fresh-context review finding 2: two different notes deriving the same
  // id must never desync byId/byPath (byId.size 1, byPath.size 2 is the
  // reported corruption — reachable via a pull landing a duplicate id).
  it("rejects a note claiming an id already owned by a DIFFERENT path, leaving both maps unchanged", () => {
    const store = createStore();
    const first = note({ id: "DEC-1", path: "decisions/a.md" });
    const second = note({ id: "DEC-1", path: "decisions/b.md", title: "A different note" });

    const firstResult = putNote(store, first);
    expect(firstResult).toEqual({ ok: true });

    const secondResult = putNote(store, second);
    expect(secondResult).toEqual({ ok: false, conflictingPath: "decisions/a.md" });

    // No desync: exactly one note is indexed, under its own path/id only.
    expect(store.byId.size).toBe(1);
    expect(store.byPath.size).toBe(1);
    expect(store.byId.get("DEC-1")).toBe(first);
    expect(store.byPath.get("decisions/a.md")).toBe(first);
    expect(store.byPath.has("decisions/b.md")).toBe(false);
  });

  it("allows re-putting the SAME path under the same id (an update, not a collision)", () => {
    const store = createStore();
    const original = note({ id: "DEC-1", path: "decisions/a.md", status: "proposed" });
    const updated = note({ id: "DEC-1", path: "decisions/a.md", status: "accepted" });

    expect(putNote(store, original)).toEqual({ ok: true });
    expect(putNote(store, updated)).toEqual({ ok: true });

    expect(store.byId.size).toBe(1);
    expect(store.byPath.size).toBe(1);
    expect(store.byId.get("DEC-1")).toBe(updated);
  });

  it("allows a note at the same path to change its own id, cleaning up the old id mapping", () => {
    const store = createStore();
    const original = note({ id: "DEC-1", path: "decisions/a.md" });
    const renamed = note({ id: "DEC-2", path: "decisions/a.md" });

    putNote(store, original);
    const result = putNote(store, renamed);

    expect(result).toEqual({ ok: true });
    expect(store.byId.has("DEC-1")).toBe(false); // stale id mapping cleaned up
    expect(store.byId.get("DEC-2")).toBe(renamed);
    expect(store.byPath.get("decisions/a.md")).toBe(renamed);
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

  // Fresh-context review finding 2: removeNote must only clear the byId
  // slot when it still points at the exact note being removed — never an
  // unrelated note that happens to share the same id (defensive, in case
  // a byId/byPath desync ever arises through a path other than putNote).
  it("only clears the byId entry when it currently points at the note being removed", () => {
    const store = createStore();
    const owner = note({ id: "DEC-1", path: "decisions/owner.md" });
    putNote(store, owner);

    // Simulate a hypothetical desync: byPath gains a second entry sharing
    // the same id, without going through putNote's collision guard.
    const impostor = note({ id: "DEC-1", path: "decisions/impostor.md" });
    store.byPath.set(impostor.path, impostor);

    removeNote(store, impostor.path);

    // The impostor's own path entry is gone, but the real owner (still
    // the one byId actually points at) must survive untouched.
    expect(store.byPath.has(impostor.path)).toBe(false);
    expect(store.byId.get("DEC-1")).toBe(owner);
    expect(store.byPath.get("decisions/owner.md")).toBe(owner);
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
