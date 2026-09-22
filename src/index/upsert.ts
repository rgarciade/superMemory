import type { RulesModel } from "../rules/types.js";
import { parseNoteAt, resolveNoteType } from "./build.js";
import { putNote, removeNote, type IndexStore } from "./store.js";

/**
 * Incremental update without a full rebuild (index spec). `upsertNote`
 * backs the save path (a note written through the system becomes
 * immediately visible); `reparseFiles` backs the post-pull path, where
 * git names the changed files — only those files are ever re-read.
 */

export async function upsertNote(
  store: IndexStore,
  vaultPath: string,
  relPath: string,
  rules: RulesModel,
): Promise<void> {
  const resolved = resolveNoteType(relPath, rules);
  if (!resolved) return;

  try {
    const note = await parseNoteAt(vaultPath, relPath, resolved.type, resolved.def);
    putNote(store, note);
  } catch (err) {
    if (isEnoent(err)) {
      removeNote(store, relPath);
      return;
    }
    throw err;
  }
}

/** Re-parses only the named files — never a full vault re-walk. */
export async function reparseFiles(
  store: IndexStore,
  vaultPath: string,
  rules: RulesModel,
  paths: string[],
): Promise<void> {
  for (const relPath of paths) {
    await upsertNote(store, vaultPath, relPath, rules);
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
