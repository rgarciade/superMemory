import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { backlinks } from "../../index/queries.js";
import type { IndexStore } from "../../index/store.js";
import type { IndexedNote } from "../../index/types.js";

/**
 * `read_with_context` — the knowledge neighborhood (tool-catalog spec):
 * content + frontmatter, backlinks (wikilinks and spec_id references),
 * referenced specs' status, and the 5 most recent linked decisions/
 * incidents.
 */

export interface ReadWithContextDeps {
  store: IndexStore;
}

export interface ReadWithContextArgs {
  id: string;
}

const RECENT_LINKED_LIMIT = 5;

export function createReadWithContextHandler(deps: ReadWithContextDeps) {
  return (args: ReadWithContextArgs): CallToolResult => {
    const note = deps.store.byId.get(args.id);
    if (!note) {
      return errorResult(`no note found with id "${args.id}"`);
    }

    const linkers = backlinks(deps.store, note.id);

    const referencedSpecIds = new Set<string>();
    for (const target of note.wikilinks) {
      const candidate = deps.store.byId.get(target);
      if (candidate && candidate.type === "spec" && candidate.id !== note.id) {
        referencedSpecIds.add(candidate.id);
      }
    }
    if (note.specId && note.specId !== note.id) {
      const spec = deps.store.byId.get(note.specId);
      if (spec && spec.type === "spec") referencedSpecIds.add(spec.id);
    }
    const referencedSpecs = [...referencedSpecIds]
      .map((id) => deps.store.byId.get(id))
      .filter((n): n is IndexedNote => n !== undefined)
      .map((n) => ({ id: n.id, status: n.status }));

    const recentLinked = linkers
      .filter((linker) => linker.type === "decision" || linker.type === "incident")
      .map((linker) => deps.store.byId.get(linker.id))
      .filter((n): n is IndexedNote => n !== undefined)
      .sort((a, b) => dateOf(b) - dateOf(a))
      .slice(0, RECENT_LINKED_LIMIT)
      .map(toSummary);

    return toResult({
      id: note.id,
      type: note.type,
      title: note.title,
      path: note.path,
      frontmatter: note.frontmatter,
      content: note.body,
      backlinks: linkers,
      referencedSpecs,
      recentLinked,
    });
  };
}

function dateOf(note: IndexedNote): number {
  const raw = note.frontmatter["date"];
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === "string") {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return 0;
}

function toSummary(note: IndexedNote) {
  return {
    id: note.id,
    type: note.type,
    title: note.title,
    path: note.path,
    ...(note.status !== undefined ? { status: note.status } : {}),
  };
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
