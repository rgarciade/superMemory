import type { IndexStore } from "./store.js";
import type { IndexedNote } from "./types.js";

/**
 * Deterministic regeneration of `index/` markdown maps from the store
 * (design OD-5) — the committed, Obsidian-readable team surface and the
 * input for P3's `chore(index)` commits. One map per note type present
 * in the store; entries sorted by path for stable, byte-identical output
 * across regenerations (never hand-edited — RFC §4.1).
 */

export interface IndexMapFile {
  /** Relative to the vault root, e.g. "index/spec.md". */
  path: string;
  content: string;
}

export function generateIndexMaps(store: IndexStore): IndexMapFile[] {
  const byType = groupByType(store);
  return [...byType.keys()].sort().map((type) => ({
    path: `index/${type}.md`,
    content: renderTypeMap(type, byType.get(type) ?? []),
  }));
}

function groupByType(store: IndexStore): Map<string, IndexedNote[]> {
  const byType = new Map<string, IndexedNote[]>();
  for (const note of store.byId.values()) {
    const list = byType.get(note.type);
    if (list) {
      list.push(note);
    } else {
      byType.set(note.type, [note]);
    }
  }
  return byType;
}

function renderTypeMap(type: string, notes: IndexedNote[]): string {
  const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path));
  const header = `# ${capitalize(type)} index\n\nGenerated — do not edit by hand.\n\n`;
  if (sorted.length === 0) {
    return `${header}_No ${type} notes yet._\n`;
  }
  const rows = sorted.map(renderEntry).join("\n");
  return `${header}${rows}\n`;
}

function renderEntry(note: IndexedNote): string {
  const status = note.status ? ` (${note.status})` : "";
  return `- [${note.title}](../${note.path}) — \`${note.id}\`${status}`;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}
