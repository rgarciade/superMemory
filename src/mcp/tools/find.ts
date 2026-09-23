import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { findNotes } from "../../index/queries.js";
import type { IndexStore } from "../../index/store.js";
import type { QueryFilters } from "../../index/types.js";

/**
 * `find` — property + free-text search via `index/queries.ts` (tool-catalog
 * spec: "find — structured and full-text search"). `index/queries.ts` is
 * the only module outside `src/index` allowed to read the store (design
 * §3 — the OD-5 swap seam depends on it); every external read goes
 * through `findNotes`/`backlinks`/`getNoteById`/`listNotes`, never
 * `store.byId`/`store.byPath` directly.
 */

export interface FindDeps {
  store: IndexStore;
}

export interface FindArgs {
  type?: string;
  status?: string;
  spec_id?: string;
  tags?: string[];
  owner?: string;
  date_field?: string;
  date_from?: string;
  date_to?: string;
  text?: string;
  limit?: number;
}

export function createFindHandler(deps: FindDeps) {
  return (args: FindArgs): CallToolResult => {
    const filters: QueryFilters = {
      ...(args.type !== undefined ? { type: args.type } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.spec_id !== undefined ? { specId: args.spec_id } : {}),
      ...(args.tags !== undefined ? { tags: args.tags } : {}),
      ...(args.owner !== undefined ? { owner: args.owner } : {}),
      ...(args.date_field !== undefined ? { dateField: args.date_field } : {}),
      ...(args.date_from !== undefined ? { dateFrom: new Date(args.date_from) } : {}),
      ...(args.date_to !== undefined ? { dateTo: new Date(args.date_to) } : {}),
      ...(args.text !== undefined ? { text: args.text } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    };
    const results = findNotes(deps.store, filters);
    return toResult({ results });
  };
}

function toResult(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}
