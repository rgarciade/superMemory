import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { buildIndexedNote } from "../index/build.js";
import { getNoteById } from "../index/queries.js";
import { moveNote, type IndexStore } from "../index/store.js";
import { upsertNote } from "../index/upsert.js";
import type { Clock } from "../util/clock.js";
import { validateNote, type ValidationIssue } from "../rules/validate.js";
import type { RulesModel } from "../rules/types.js";
import { deriveNoteId, deriveTitle, parseNoteFile } from "./parse.js";
import { appendLinkedKnowledgeEntry } from "./linked-knowledge.js";

/**
 * Save orchestration (tool-catalog spec `save` requirement; design §5.3):
 * validate -> render/merge -> pull-before-write (update only, via an
 * injected SyncPort) -> write -> index.upsert -> SyncPort.notifyWrite ->
 * { path, id }. `notes/save-pipeline` needs pull-before-write and write
 * notification (owned by `sync`, landing in P3); a direct import would
 * cycle, so the port is injected by the composition root (design §1.3).
 * A null port is injected in P2.
 */

export interface WriteEvent {
  op: "add" | "update" | "delete";
  type: string;
  id?: string;
  path: string;
  via: string;
  at: Date;
}

export interface SyncPort {
  /** Update-only pull-before-write; a no-op on create. */
  pullLatest(notePath?: string): Promise<void>;
  notifyWrite(event: WriteEvent): void;
}

export function createNullSyncPort(): SyncPort {
  return {
    pullLatest: async () => {},
    notifyWrite: () => {},
  };
}

export interface SaveNoteDeps {
  store: IndexStore;
  clock: Clock;
  syncPort: SyncPort;
}

export interface SaveNoteInput {
  vaultPath: string;
  rules: RulesModel;
  type: string;
  /** Vault-relative path the note is saved at. */
  path: string;
  frontmatter: Record<string, unknown>;
  /** Markdown body. Omit on update to keep the existing body. */
  content?: string;
  /** Provenance for the write event (e.g. "mcp:claude", "cli"). */
  via: string;
  /**
   * The note's current vault-relative path, when it differs from `path`
   * (design decision, second re-review: a note's identity is its id — an
   * update whose derived path changed, e.g. a title change on a
   * `{id}-{slug}.md` type, is a MOVE, not two separate notes). When set
   * and different from `path`, `saveNote` writes the new file, deletes
   * the old one, and atomically swaps the index entry. Equal to `path`
   * (or omitted) is an ordinary create/update at the same location.
   */
  previousPath?: string;
}

export type SaveNoteResult =
  | { ok: true; path: string; id?: string }
  | { ok: false; issues: ValidationIssue[] };

export async function saveNote(
  deps: SaveNoteDeps,
  input: SaveNoteInput,
): Promise<SaveNoteResult> {
  const fileName = path.basename(input.path);
  const folder = folderOf(input.path);

  // Reject a path escaping the type's declared folder BEFORE touching
  // the filesystem at all (fresh-context review finding 8) — e.g. a
  // `../` traversal in `input.path` computes a folder that can never
  // match `def.folder`. Without this, a traversal path that happens to
  // exist (a file OR a directory) gets stat'd and read before the
  // (already-correct) rejection — for a directory, `readFile` throws
  // EISDIR uncaught instead of a clean validation result.
  const preCheckIssues = validateNote(input.rules, {
    type: input.type,
    frontmatter: input.frontmatter,
    fileName,
    folder,
  }).filter((issue) => issue.kind === "folder");
  if (preCheckIssues.length > 0) return { ok: false, issues: preCheckIssues };

  const fileAbs = path.join(input.vaultPath, input.path);
  const exists = await fileExists(fileAbs);
  const op: WriteEvent["op"] = exists ? "update" : "add";

  // Validate the note that would actually be written: on update, `input`
  // may carry only a partial patch, so the merged (final) frontmatter is
  // what must conform — not the raw patch in isolation.
  const { frontmatter, body } = await mergeNoteContent(fileAbs, exists, input);
  const issues = validateNote(input.rules, {
    type: input.type,
    frontmatter,
    fileName,
    folder,
  });
  if (issues.length > 0) return { ok: false, issues };

  if (exists) {
    await deps.syncPort.pullLatest(input.path);
  }

  const noteTypeDef = input.rules.noteTypes[input.type];
  if (!noteTypeDef) {
    // Unreachable in practice: validateNote already rejected an unknown
    // type above. Guarded for type safety, not a real code path.
    return { ok: false, issues: [{ kind: "field", message: `unknown note type "${input.type}"` }] };
  }

  await writeNoteFile(fileAbs, frontmatter, body);

  if (input.previousPath !== undefined && input.previousPath !== input.path) {
    // MOVE (design decision, second re-review — recorded in
    // apply-progress.md): a note's identity is its id, so an update
    // whose derived path changed (e.g. a title change on a
    // `{id}-{slug}.md` type) deletes the old file and atomically swaps
    // the index entry — removeNote(oldPath) then putNote(new), no
    // `await` between them, built synchronously from the
    // already-in-memory frontmatter/body (no disk re-read, which would
    // reintroduce a yield point). The store is never observed with both
    // paths indexed, or neither.
    const previousPath = input.previousPath;
    await rm(path.join(input.vaultPath, previousPath), { force: true });
    const newNote = buildIndexedNote(input.type, input.path, frontmatter, body, noteTypeDef);
    const moveResult = moveNote(deps.store, previousPath, newNote);
    if (!moveResult.ok) {
      // NEW-1: fail loudly instead of reporting success while the write
      // is unindexed — the file is on disk, but the caller must know
      // the index could not be updated (an id genuinely still owned by
      // a third, unrelated path).
      return {
        ok: false,
        issues: [
          {
            kind: "field",
            message:
              `save wrote "${input.path}" but could not update the index: the id is ` +
              `still owned by "${moveResult.conflictingPath}"`,
          },
        ],
      };
    }
  } else {
    const upsertResult = await upsertNote(deps.store, input.vaultPath, input.path, input.rules);
    if (!upsertResult.ok) {
      // NEW-1: same "fail loudly" guarantee for the non-move path — a
      // genuine id collision (e.g. a duplicate id already present from a
      // pull) must not be reported as a successful save.
      return {
        ok: false,
        issues: [
          {
            kind: "field",
            message:
              `save wrote "${input.path}" but could not update the index: the id is ` +
              `already owned by "${upsertResult.conflictingPath}"`,
          },
        ],
      };
    }
  }

  const id = deriveNoteId(input.type, frontmatter, noteTypeDef);

  await maintainLinkedKnowledgeIfNeeded(deps, input, frontmatter, {
    id,
    title: deriveTitle(body, frontmatter, fileName),
  });

  deps.syncPort.notifyWrite({
    op,
    type: input.type,
    ...(id !== undefined ? { id } : {}),
    path: input.path,
    via: input.via,
    at: deps.clock.now(),
  });

  return { ok: true, path: input.path, ...(id !== undefined ? { id } : {}) };
}

async function mergeNoteContent(
  fileAbs: string,
  exists: boolean,
  input: SaveNoteInput,
): Promise<{ frontmatter: Record<string, unknown>; body: string }> {
  if (!exists) {
    return { frontmatter: input.frontmatter, body: input.content ?? "" };
  }
  const raw = await readFile(fileAbs, "utf8");
  const current = parseNoteFile(raw);
  return {
    frontmatter: { ...current.frontmatter, ...input.frontmatter },
    body: input.content ?? current.body,
  };
}

async function writeNoteFile(
  fileAbs: string,
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<void> {
  await mkdir(path.dirname(fileAbs), { recursive: true });
  const serialized = matter.stringify(body, frontmatter);
  await writeFile(fileAbs, serialized, "utf8");
}

/**
 * A note saved with `spec_id` set (and that isn't itself a spec) links
 * into its hub's Linked Knowledge section — "spec" is the hub type name
 * used consistently across the RFC/design, not a rule-declared property.
 */
async function maintainLinkedKnowledgeIfNeeded(
  deps: SaveNoteDeps,
  input: SaveNoteInput,
  frontmatter: Record<string, unknown>,
  linked: { id: string | undefined; title: string },
): Promise<void> {
  const specId = frontmatter["spec_id"];
  if (input.type === "spec" || typeof specId !== "string" || specId === "") return;
  if (linked.id === undefined) return;

  const specNote = getNoteById(deps.store, specId);
  if (!specNote || specNote.type !== "spec") return;

  const specAbs = path.join(input.vaultPath, specNote.path);
  const raw = await readFile(specAbs, "utf8");
  const specFile = parseNoteFile(raw);
  const updatedBody = appendLinkedKnowledgeEntry(specFile.body, {
    id: linked.id,
    type: input.type,
    title: linked.title,
    path: input.path,
  });
  if (updatedBody === specFile.body) return; // idempotent — already linked

  await writeNoteFile(specAbs, specFile.frontmatter, updatedBody);
  await upsertNote(deps.store, input.vaultPath, specNote.path, input.rules);
}

async function fileExists(fileAbs: string): Promise<boolean> {
  try {
    await access(fileAbs);
    return true;
  } catch {
    return false;
  }
}

function folderOf(relPath: string): string {
  const normalized = relPath.split(path.sep).join("/");
  const dir = path.posix.dirname(normalized);
  return dir === "." ? "" : `${dir}/`;
}
