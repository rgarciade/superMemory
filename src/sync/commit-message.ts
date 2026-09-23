import type { NoteTypeDef } from "../rules/types.js";
import { deriveNoteId, deriveTitle } from "../notes/parse.js";

/**
 * The commit grammar (design §4.3) — one pure module owns derivation
 * *and* parsing (task 3.2 absorbed 2.14's local header parser, so the
 * `changes_since` tool and the engine's commit path can never drift
 * apart).
 *
 * Header: `note(<add|update|delete>): <type> "<title>" [<id>]`, plus a
 * meaningful-change suffix (` (status: draft→active)`) on updates whose
 * lifecycle-relevant frontmatter transitioned. Trailers (final
 * paragraph, git interpret-trailers format): `Author:` (human display
 * name), `Via:` (agent/client provenance), `Spec:` (linked spec_id).
 *
 * `git log --grep=<id>` is the query interface this grammar backs: the
 * same inputs always derive the identical message.
 */

export type NoteCommitOp = "add" | "update" | "delete";

export interface ParsedNoteCommitHeader {
  op: NoteCommitOp;
  type: string;
  title: string;
  id?: string;
  statusChanged: boolean;
  /** The decomposed ` (status: from→to)` suffix, when present. */
  statusTransition?: { from: string; to: string };
}

const HEADER_PATTERN =
  /^note\((add|update|delete)\): (\S+) "([^"]*)"(?: \[([^\]]+)\])?/;
const STATUS_SUFFIX_PATTERN = /(?: \((status: ([^→)]+)→([^)]+)\)))?$/;

/**
 * Parses a commit header against the note grammar. Returns `undefined`
 * for every non-grammar header (chore commits, merge commits, human
 * messages) — `changes_since` filters on exactly this.
 */
export function parseNoteCommitHeader(header: string): ParsedNoteCommitHeader | undefined {
  const match = HEADER_PATTERN.exec(header);
  if (!match) return undefined;
  const [, op, type, title, id] = match;
  const suffix = STATUS_SUFFIX_PATTERN.exec(header);
  const transition =
    suffix?.[2] !== undefined && suffix?.[3] !== undefined
      ? { from: suffix[2], to: suffix[3] }
      : undefined;
  return {
    op: op as NoteCommitOp,
    type: type ?? "",
    title: title ?? "",
    ...(id !== undefined ? { id } : {}),
    statusChanged: transition !== undefined,
    ...(transition !== undefined ? { statusTransition: transition } : {}),
  };
}

export interface DeriveCommitMessageInput {
  op: NoteCommitOp;
  type: string;
  frontmatter: Record<string, unknown>;
  /** Body of the note — title derivation (first `#` heading wins). */
  body: string;
  /** File base name — the slug fallback for the title. */
  fileName: string;
  /** The type's declaration (id-field resolution); convention `<type>_id` otherwise. */
  noteTypeDef?: NoteTypeDef;
  /** Previous frontmatter (updates): a status transition derives the meaningful-change suffix. */
  prevFrontmatter?: Record<string, unknown>;
  /** Human display name — the `Author:` trailer (git blame shows people, §4.3). */
  author?: string;
  /** Agent/client provenance — the `Via:` trailer. */
  via?: string;
}

export interface CommitMessage {
  header: string;
  /** Deterministic order: Author, Via, Spec (absent keys omitted). */
  trailers: Record<string, string>;
}

/**
 * Derives a commit message from note frontmatter — no LLM, no free text
 * from the agent. For deletions, derive the inputs from the HEAD version
 * of the file (`git show HEAD:<path>`) — fetching that version is the
 * caller's job; derivation itself stays pure.
 */
export function deriveCommitMessage(input: DeriveCommitMessageInput): CommitMessage {
  const { op, type, frontmatter, body, fileName, noteTypeDef } = input;

  const title = deriveTitle(body, frontmatter, fileName);
  const id = deriveNoteId(type, frontmatter, noteTypeDef);
  const header =
    `note(${op}): ${type} "${title}"` +
    (id !== undefined ? ` [${id}]` : "") +
    statusSuffix(input);

  const trailers: Record<string, string> = {};
  if (input.author !== undefined && input.author !== "") trailers["Author"] = input.author;
  if (input.via !== undefined && input.via !== "") trailers["Via"] = input.via;
  const specId = frontmatter["spec_id"];
  if (typeof specId === "string" && specId !== "") trailers["Spec"] = specId;

  return { header, trailers };
}

/** Full `git commit -m` text: header, blank line, trailer block. */
export function formatCommitMessage(message: CommitMessage): string {
  const entries = Object.entries(message.trailers);
  if (entries.length === 0) return message.header;
  const trailerBlock = entries.map(([key, value]) => `${key}: ${value}`).join("\n");
  return `${message.header}\n\n${trailerBlock}`;
}

/**
 * Conflict-note commit header (design §4.4): the ladder's curated path
 * commits the conflict note itself, linted, with this exact header.
 * Lives here — not inline in the engine — because commit grammar has
 * exactly one home (design §3 ownership table).
 */
export function conflictNoteCommitHeader(noteId: string): string {
  return `chore(conflict): record divergent edits for ${noteId}`;
}

/**
 * The meaningful-change suffix (design §4.3): appended when a
 * lifecycle-relevant field (canonical: `status`) transitions between
 * the previous and current frontmatter. Body-only edits produce none.
 */
function statusSuffix(input: DeriveCommitMessageInput): string {
  const { frontmatter, prevFrontmatter } = input;
  if (prevFrontmatter === undefined) return "";
  const prev = prevFrontmatter["status"];
  const next = frontmatter["status"];
  if (typeof prev !== "string" || typeof next !== "string") return "";
  if (prev === next) return "";
  return ` (status: ${prev}→${next})`;
}
