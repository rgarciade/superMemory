import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertNoSecrets } from "./secrets.js";
import { parseNoteFile } from "../notes/parse.js";

/**
 * Conflict notes (design §4.4): the curated path's human surface. When a
 * rebase is aborted for a curated conflict, the engine writes
 * `conflicts/<date>-<note-id>.md` INTO THE VAULT — top-level, not under
 * `.memory/`, because it must be visible in Obsidian (RFC: "no git
 * knowledge required"). Frontmatter carries the machine contract
 * (`status`, `note_path`, `snapshot_branch`, `detected_at`); the body
 * summarizes both sides and points at `supermemory resolve`.
 *
 * Writing lints: the note becomes a `chore(conflict)` commit, so a
 * secret must never land in it (sync-ladder spec: lint at every ladder
 * stage that creates a commit).
 */

export interface ConflictNoteData {
  noteId: string;
  /** Vault-relative path of the conflicted note. */
  notePath: string;
  /** The snapshot branch holding the incoming side. */
  snapshotBranch: string;
  detectedAt: Date;
  localSummary: string;
  remoteSummary: string;
}

export interface ConflictNoteRecord {
  /** Absolute path of the conflict note file. */
  path: string;
  status: string;
  noteId: string;
  notePath: string;
  snapshotBranch: string;
  detectedAt: string;
}

/** `conflicts/<YYYYMMDD-HHMM>-<sanitized note id>.md` (UTC, design §4.4). */
export function conflictNoteFileName(detectedAt: Date, noteId: string): string {
  return `${dateStamp(detectedAt)}-${sanitizeId(noteId)}.md`;
}

/** Snapshot branch for the incoming side: `conflict/<YYYYMMDD-HHMM>-<note-id>`. */
export function conflictSnapshotBranchName(detectedAt: Date, noteId: string): string {
  return `conflict/${dateStamp(detectedAt)}-${sanitizeId(noteId)}`;
}

/** Pure renderer: frontmatter contract + both sides + resolve pointer. */
export function renderConflictNote(data: ConflictNoteData): string {
  const detectedAt = data.detectedAt.toISOString();
  return [
    "---",
    `status: open`,
    `note_id: ${data.noteId}`,
    `note_path: ${data.notePath}`,
    `snapshot_branch: ${data.snapshotBranch}`,
    `detected_at: ${detectedAt}`,
    "---",
    "",
    `# Conflict: ${data.noteId}`,
    "",
    "Divergent edits to the same region were detected on this note. Both",
    "versions are preserved — nothing was deleted.",
    "",
    "## Local side",
    "",
    data.localSummary,
    "",
    "## Remote side",
    "",
    data.remoteSummary,
    "",
    "## Resolution",
    "",
    "Run `supermemory resolve` to see both sides side by side, merge them,",
    "and finish the sync. Git experts may resolve manually — the remote",
    `version is recoverable from the \`${data.snapshotBranch}\` branch.`,
    "",
  ].join("\n");
}

/**
 * Renders, lints, and writes the conflict note. Returns its absolute
 * path. Throws `SECRETS_BLOCKED` before anything touches disk when a
 * summary carries a flagged secret.
 */
export async function writeConflictNote(
  conflictsDir: string,
  data: ConflictNoteData,
): Promise<string> {
  const fileName = conflictNoteFileName(data.detectedAt, data.noteId);
  const rendered = renderConflictNote(data);
  assertNoSecrets(fileName, rendered);
  await mkdir(conflictsDir, { recursive: true });
  const abs = path.join(conflictsDir, fileName);
  await writeFile(abs, rendered, "utf8");
  return abs;
}

/**
 * Reads every conflict note in `conflicts/`, sorted by file name
 * (deterministic). Non-markdown files are ignored; malformed notes are
 * skipped — reading must never take the engine down. `status` is taken
 * verbatim from frontmatter (`open` until `resolve` flips it).
 */
export async function readConflictNotes(conflictsDir: string): Promise<ConflictNoteRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(conflictsDir);
  } catch {
    return []; // no conflicts/ dir yet = no conflicts
  }
  const records: ConflictNoteRecord[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;
    const abs = path.join(conflictsDir, entry);
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    const { frontmatter } = parseNoteFile(raw);
    // gray-matter parses unquoted ISO timestamps as Date instances —
    // normalize them back to the written ISO string.
    const detectedAtRaw = frontmatter["detected_at"];
    const detectedAt =
      detectedAtRaw instanceof Date ? detectedAtRaw.toISOString() : detectedAtRaw;
    const noteId = frontmatter["note_id"];
    const notePath = frontmatter["note_path"];
    const snapshotBranch = frontmatter["snapshot_branch"];
    const status = frontmatter["status"];
    if (
      typeof noteId !== "string" ||
      typeof notePath !== "string" ||
      typeof snapshotBranch !== "string" ||
      typeof detectedAt !== "string" ||
      typeof status !== "string"
    ) {
      continue; // malformed: skipped, never fatal
    }
    records.push({ path: abs, status, noteId, notePath, snapshotBranch, detectedAt });
  }
  return records;
}

function dateStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
  );
}

function sanitizeId(noteId: string): string {
  return noteId.replace(/[/\\]/g, "-");
}
