/**
 * Spec hub Linked Knowledge section maintenance (tool-catalog spec, `save`
 * requirement): entries are appended when a note carrying `spec_id` is
 * created; repeated saves of the same note MUST NOT create duplicate
 * entries. Pure string transformation over the note body (frontmatter
 * already stripped) — the caller owns reading/writing the spec file.
 */

const LINKED_KNOWLEDGE_HEADING = "## Linked Knowledge";
const HEADING_PATTERN = /\n#{1,6}\s+.*/g;

export interface LinkedKnowledgeEntry {
  /** The linked note's derived id — the dedupe key. */
  id: string;
  type: string;
  title: string;
  /** Vault-relative path to the linked note. */
  path: string;
}

export function appendLinkedKnowledgeEntry(
  body: string,
  entry: LinkedKnowledgeEntry,
): string {
  const marker = entryMarker(entry.id);
  if (body.includes(marker)) return body; // already linked — idempotent

  const entryLine = renderEntry(entry);
  const headingIndex = body.indexOf(LINKED_KNOWLEDGE_HEADING);

  if (headingIndex === -1) {
    const trimmed = body.replace(/\s+$/, "");
    const separator = trimmed.length > 0 ? "\n\n" : "";
    return `${trimmed}${separator}${LINKED_KNOWLEDGE_HEADING}\n\n${entryLine}\n`;
  }

  const searchFrom = headingIndex + LINKED_KNOWLEDGE_HEADING.length;
  const insertAt = findNextHeadingIndex(body, searchFrom) ?? body.length;

  const before = body.slice(0, insertAt).replace(/\s+$/, "");
  const rest = body.slice(insertAt);
  const restTrimmedLeadingNewlines = rest.replace(/^\n+/, "");
  const tail = restTrimmedLeadingNewlines.length > 0 ? `\n\n${restTrimmedLeadingNewlines}` : "\n";

  return `${before}\n${entryLine}${tail}`;
}

function findNextHeadingIndex(body: string, from: number): number | undefined {
  HEADING_PATTERN.lastIndex = from;
  const match = HEADING_PATTERN.exec(body);
  return match ? match.index + 1 : undefined; // +1: skip the leading \n, land on the heading
}

function entryMarker(id: string): string {
  return `<!-- linked:${id} -->`;
}

function renderEntry(entry: LinkedKnowledgeEntry): string {
  return `- [${entry.title}](../${entry.path}) — ${entry.type} ${entryMarker(entry.id)}`;
}
