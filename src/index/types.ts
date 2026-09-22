/**
 * In-memory index data contracts (design OD-5, §7). `IndexedNote` is the
 * unit the store holds; `QueryFilters`/`FindResultItem` shape the only
 * external query surface (`queries.ts`). Pure types — no I/O here.
 */

export interface IndexedNote {
  /**
   * Derived id (design §4.3 id-derivation rule, shared with notes/parse.ts):
   * the type's explicit `id_field`, else `<type>_id` from frontmatter, else
   * the note's own vault-relative path (stable fallback for note types that
   * declare no id field, e.g. session logs).
   */
  id: string;
  type: string;
  title: string;
  /** Vault-relative path, forward-slash separated. */
  path: string;
  status?: string;
  /** This note's own `spec_id` frontmatter reference (the hub it belongs to). */
  specId?: string;
  owner?: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  /** Markdown body (frontmatter stripped). */
  body: string;
  /** Raw wikilink targets found in the body (`[[Target]]`). */
  wikilinks: string[];
}

export interface QueryFilters {
  type?: string;
  status?: string;
  specId?: string;
  /** A note must carry every listed tag (AND). */
  tags?: string[];
  owner?: string;
  /** Frontmatter field the date range applies to (e.g. "review_after"). */
  dateField?: string;
  dateFrom?: Date;
  dateTo?: Date;
  /** Case-insensitive substring scan over title + body. */
  text?: string;
  /** Defaults to 20 (tool-catalog spec: `find` default limit). */
  limit?: number;
}

export interface FindResultItem {
  id: string;
  title: string;
  status?: string;
  path: string;
  type: string;
}
