import matter from "gray-matter";
import type { NoteTypeDef } from "../rules/types.js";

/**
 * gray-matter parse + deterministic id/title derivation (design §4.3),
 * shared by the save pipeline, the index build/upsert, and (P3) commit
 * grammar derivation — one source of truth so parse, grammar, and index
 * always agree.
 */

export interface ParsedNoteFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseNoteFile(raw: string): ParsedNoteFile {
  const { data, content } = matter(raw);
  return { frontmatter: data as Record<string, unknown>, body: content };
}

/**
 * Title priority (design §4.3): first `# heading` of the body, else a
 * `title` frontmatter field, else the filename slug.
 */
export function deriveTitle(
  body: string,
  frontmatter: Record<string, unknown>,
  fileName: string,
): string {
  const heading = /^#\s+(.+)$/m.exec(body);
  if (heading?.[1]) return heading[1].trim();

  const fmTitle = frontmatter["title"];
  if (typeof fmTitle === "string" && fmTitle.trim() !== "") return fmTitle.trim();

  return slugToTitle(fileName);
}

function slugToTitle(fileName: string): string {
  const base = fileName.replace(/\.md$/i, "");
  return base
    .split(/[-_]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Id resolution (design §4.3): the type's explicit `id_field` if declared,
 * else `<type>_id` when present in frontmatter, else `undefined` (omitted
 * — e.g. session logs declare no id field).
 */
export function deriveNoteId(
  type: string,
  frontmatter: Record<string, unknown>,
  noteType: NoteTypeDef | undefined,
): string | undefined {
  const idField = noteType?.idField ?? `${type}_id`;
  const value = frontmatter[idField];
  return typeof value === "string" ? value : undefined;
}
