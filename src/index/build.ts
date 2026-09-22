import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { deriveNoteId, deriveTitle, parseNoteFile } from "../notes/parse.js";
import type { NoteTypeDef, RulesModel } from "../rules/types.js";
import { createStore, extractWikilinks, putNote, type IndexStore } from "./store.js";
import type { IndexedNote } from "./types.js";

/**
 * Vault walk + gray-matter parse into a populated in-memory store (design
 * OD-5, index spec: "built in memory at startup by walking the vault").
 * Only the folders declared per note type in rules.md are walked —
 * conflict notes, `.memory/` internals, and generated `index/` maps are
 * never treated as notes.
 */

export async function buildIndex(
  vaultPath: string,
  rules: RulesModel,
): Promise<IndexStore> {
  const store = createStore();
  for (const [type, def] of Object.entries(rules.noteTypes)) {
    const folderAbs = path.join(vaultPath, def.folder);
    const relPaths = await listMarkdownFiles(vaultPath, folderAbs);
    for (const relPath of relPaths) {
      const note = await parseNoteAt(vaultPath, relPath, type, def);
      putNote(store, note);
    }
  }
  return store;
}

/** Resolves which declared note type owns `relPath`, if any. */
export function resolveNoteType(
  relPath: string,
  rules: RulesModel,
): { type: string; def: NoteTypeDef } | undefined {
  const normalized = relPath.split(path.sep).join("/");
  for (const [type, def] of Object.entries(rules.noteTypes)) {
    const folder = def.folder.endsWith("/") ? def.folder : `${def.folder}/`;
    if (normalized.startsWith(folder)) return { type, def };
  }
  return undefined;
}

/** Reads and parses a single note file into an `IndexedNote`. */
export async function parseNoteAt(
  vaultPath: string,
  relPath: string,
  type: string,
  def: NoteTypeDef,
): Promise<IndexedNote> {
  const fileAbs = path.join(vaultPath, relPath);
  const raw = await readFile(fileAbs, "utf8");
  const { frontmatter, body } = parseNoteFile(raw);
  const fileName = path.basename(fileAbs);
  const title = deriveTitle(body, frontmatter, fileName);
  const id = deriveNoteId(type, frontmatter, def) ?? relPath;
  const status = frontmatter["status"];
  const specId = frontmatter["spec_id"];
  const owner = frontmatter["owner"];
  const tags = frontmatter["tags"];
  return {
    id,
    type,
    title,
    path: relPath,
    ...(typeof status === "string" ? { status } : {}),
    ...(typeof specId === "string" ? { specId } : {}),
    ...(typeof owner === "string" ? { owner } : {}),
    tags: Array.isArray(tags) ? tags.map((tag) => String(tag)) : [],
    frontmatter,
    body,
    wikilinks: extractWikilinks(body),
  };
}

async function listMarkdownFiles(
  vaultPath: string,
  folderAbs: string,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(folderAbs, { recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.toLowerCase().endsWith(".md"))
    .map((entry) =>
      path.relative(vaultPath, path.join(folderAbs, entry)).split(path.sep).join("/"),
    )
    .sort();
}
