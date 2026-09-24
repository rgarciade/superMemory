import type { RulesModel } from "../rules/types.js";
import { parseNoteAt, resolveNoteType } from "./build.js";
import { putNote, removeNote, type IndexStore, type PutNoteResult } from "./store.js";

/**
 * Incremental update without a full rebuild (index spec). `upsertNote`
 * backs the save path (a note written through the system becomes
 * immediately visible); `reparseFiles` backs the post-pull path, where
 * git names the changed files — only those files are ever re-read.
 *
 * Propagates `putNote`'s result (second re-review, NEW-1): a genuine id
 * collision reaching this function — a true duplicate, not a move
 * (moves are handled explicitly by `notes/save-pipeline.ts` before ever
 * reaching here) — must be visible to the caller instead of silently
 * reporting success while the file goes unindexed.
 */

export async function upsertNote(
  store: IndexStore,
  vaultPath: string,
  relPath: string,
  rules: RulesModel,
): Promise<PutNoteResult> {
  const resolved = resolveNoteType(relPath, rules);
  if (!resolved) return { ok: true }; // not a declared note-type path — nothing to index, not a failure

  try {
    const note = await parseNoteAt(vaultPath, relPath, resolved.type, resolved.def);
    return putNote(store, note);
  } catch (err) {
    if (isEnoent(err)) {
      removeNote(store, relPath);
      return { ok: true };
    }
    throw err;
  }
}

/** Re-parses only the named files — never a full vault re-walk. Returns one result per path, in order. */
export async function reparseFiles(
  store: IndexStore,
  vaultPath: string,
  rules: RulesModel,
  paths: string[],
): Promise<PutNoteResult[]> {
  const results: PutNoteResult[] = [];
  for (const relPath of paths) {
    results.push(await upsertNote(store, vaultPath, relPath, rules));
  }
  return results;
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
