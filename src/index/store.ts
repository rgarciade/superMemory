import type { IndexedNote } from "./types.js";

/**
 * The in-memory index structures (design OD-5, index spec): notes by id
 * and by path, and the forward/backward link graph (wikilinks + a note's
 * own `spec_id` reference). No I/O in this module — it is a data
 * structure with explicit inputs; `build.ts`/`upsert.ts` populate it,
 * `queries.ts` is the only external read surface (design §3).
 */

export interface IndexStore {
  byId: Map<string, IndexedNote>;
  byPath: Map<string, IndexedNote>;
  /** note id -> the set of ids/targets it links to (wikilinks + spec_id). */
  forwardLinks: Map<string, Set<string>>;
  /** link target -> the set of note ids that link to it. */
  backwardLinks: Map<string, Set<string>>;
}

export function createStore(): IndexStore {
  return {
    byId: new Map(),
    byPath: new Map(),
    forwardLinks: new Map(),
    backwardLinks: new Map(),
  };
}

/** Inserts or replaces a note (keyed by path — a re-put at the same path is an update). */
export function putNote(store: IndexStore, note: IndexedNote): void {
  removeNote(store, note.path);
  store.byId.set(note.id, note);
  store.byPath.set(note.path, note);

  const targets = linkTargetsOf(note);
  store.forwardLinks.set(note.id, targets);
  for (const target of targets) {
    let backSet = store.backwardLinks.get(target);
    if (!backSet) {
      backSet = new Set();
      store.backwardLinks.set(target, backSet);
    }
    backSet.add(note.id);
  }
}

/** Drops the note at `path` (if any) and its outgoing link edges. */
export function removeNote(store: IndexStore, path: string): void {
  const existing = store.byPath.get(path);
  if (!existing) return;

  store.byPath.delete(path);
  store.byId.delete(existing.id);

  const targets = store.forwardLinks.get(existing.id);
  store.forwardLinks.delete(existing.id);
  if (targets) {
    for (const target of targets) {
      const backSet = store.backwardLinks.get(target);
      if (!backSet) continue;
      backSet.delete(existing.id);
      if (backSet.size === 0) store.backwardLinks.delete(target);
    }
  }
}

function linkTargetsOf(note: IndexedNote): Set<string> {
  const targets = new Set<string>(note.wikilinks);
  if (note.specId && note.specId !== note.id) targets.add(note.specId);
  return targets;
}

/** `[[Target]]`, `[[Target|alias]]`, `[[Target#anchor]]` — target only. */
const WIKILINK_PATTERN = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

export function extractWikilinks(body: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      targets.push(target);
    }
  }
  return targets;
}
