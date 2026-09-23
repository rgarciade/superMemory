import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { getNoteById } from "../index/queries.js";
import type { IndexStore } from "../index/store.js";
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

  await writeNoteFile(fileAbs, frontmatter, body);
  await upsertNote(deps.store, input.vaultPath, input.path, input.rules);

  const noteTypeDef = input.rules.noteTypes[input.type];
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
