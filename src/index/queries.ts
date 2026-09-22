import type { IndexStore } from "./store.js";
import type { FindResultItem, IndexedNote, QueryFilters } from "./types.js";

/**
 * The only query surface over the in-memory index (design OD-5): property
 * filters, free-text search, combined filter+text (filters narrow first),
 * and backlinks over the wikilink + spec_id graph. Deterministic result
 * ordering — no relevance ranking (OD-5 states the tradeoff).
 */

const DEFAULT_LIMIT = 20;

export function findNotes(
  store: IndexStore,
  filters: QueryFilters = {},
): FindResultItem[] {
  let candidates = [...store.byId.values()].filter((note) =>
    matchesFilters(note, filters),
  );

  if (filters.text) {
    const needle = filters.text.toLowerCase();
    candidates = candidates.filter(
      (note) =>
        note.title.toLowerCase().includes(needle) ||
        note.body.toLowerCase().includes(needle),
    );
  }

  candidates.sort(compareDeterministic);
  const limit = filters.limit ?? DEFAULT_LIMIT;
  return candidates.slice(0, limit).map(toResultItem);
}

export function backlinks(store: IndexStore, targetId: string): FindResultItem[] {
  const linkerIds = store.backwardLinks.get(targetId);
  if (!linkerIds) return [];
  const notes = [...linkerIds]
    .map((id) => store.byId.get(id))
    .filter((note): note is IndexedNote => note !== undefined);
  notes.sort(compareDeterministic);
  return notes.map(toResultItem);
}

function matchesFilters(note: IndexedNote, filters: QueryFilters): boolean {
  if (filters.type && note.type !== filters.type) return false;
  if (filters.status && note.status !== filters.status) return false;
  if (filters.specId && note.specId !== filters.specId) return false;
  if (filters.owner && note.owner !== filters.owner) return false;

  if (filters.tags && filters.tags.length > 0) {
    const tagSet = new Set(note.tags);
    if (!filters.tags.every((tag) => tagSet.has(tag))) return false;
  }

  if (filters.dateField && (filters.dateFrom || filters.dateTo)) {
    const value = toDate(note.frontmatter[filters.dateField]);
    if (!value) return false;
    if (filters.dateFrom && value < filters.dateFrom) return false;
    if (filters.dateTo && value > filters.dateTo) return false;
  }

  return true;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

function compareDeterministic(a: IndexedNote, b: IndexedNote): number {
  return a.path.localeCompare(b.path);
}

function toResultItem(note: IndexedNote): FindResultItem {
  return {
    id: note.id,
    title: note.title,
    ...(note.status !== undefined ? { status: note.status } : {}),
    path: note.path,
    type: note.type,
  };
}
