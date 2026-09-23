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
    // `new Date("garbage")` is a truthy Invalid Date — every comparison
    // against it is false, so an unparseable filter was silently ignored
    // rather than raising an actionable error (fresh-context review
    // finding 9). Reject explicitly instead.
    let dateFrom: Date | undefined;
    if (args.date_from !== undefined) {
      dateFrom = parseDateArg(args.date_from);
      if (!dateFrom) return errorResult(`invalid date_from "${args.date_from}" — expected an ISO date string`);
    }
    let dateTo: Date | undefined;
    if (args.date_to !== undefined) {
      dateTo = parseDateArg(args.date_to);
      if (!dateTo) return errorResult(`invalid date_to "${args.date_to}" — expected an ISO date string`);
    }

    const filters: QueryFilters = {
      ...(args.type !== undefined ? { type: args.type } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.spec_id !== undefined ? { specId: args.spec_id } : {}),
      ...(args.tags !== undefined ? { tags: args.tags } : {}),
      ...(args.owner !== undefined ? { owner: args.owner } : {}),
      ...(args.date_field !== undefined ? { dateField: args.date_field } : {}),
      ...(dateFrom !== undefined ? { dateFrom } : {}),
      ...(dateTo !== undefined ? { dateTo } : {}),
      ...(args.text !== undefined ? { text: args.text } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    };
    const results = findNotes(deps.store, filters);
    return toResult({ results });
  };
}

function parseDateArg(value: string): Date | undefined {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toResult(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
    isError: true,
  };
}
