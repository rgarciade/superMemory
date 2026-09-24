import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { simpleGit, type SimpleGit } from "simple-git";
import {
  parseNoteCommitHeader,
  type NoteCommitOp,
} from "../../sync/commit-message.js";

/**
 * `changes_since` — note-granularity continuity (tool-catalog spec): an
 * ISO timestamp -> a git-log walk filtered to note-grammar commits,
 * classified per note as added/updated/status_changed/removed.
 *
 * The header grammar is owned by `src/sync/commit-message.ts` (design
 * §4.3): since task 3.2 this tool parses with that shared module instead
 * of a local copy, so classification and commit derivation can never
 * drift apart.
 */

export type { NoteCommitOp } from "../../sync/commit-message.js";
export type ChangeClassification = "added" | "updated" | "status_changed" | "removed";

export interface NoteChange {
  id?: string;
  type: string;
  title: string;
  classification: ChangeClassification;
  commit: string;
  at: string;
}

export interface ChangesSinceDeps {
  vaultPath: string;
}

export interface ChangesSinceArgs {
  since: string;
}

function classify(op: NoteCommitOp, statusChanged: boolean): ChangeClassification {
  if (op === "add") return "added";
  if (op === "delete") return "removed";
  return statusChanged ? "status_changed" : "updated";
}

export function createChangesSinceHandler(
  deps: ChangesSinceDeps,
  gitFactory: (dir: string) => SimpleGit = simpleGit,
) {
  return async (args: ChangesSinceArgs): Promise<CallToolResult> => {
    const since = new Date(args.since);
    if (Number.isNaN(since.getTime())) {
      // `new Date("garbage")` is a truthy Invalid Date — every comparison
      // against it is false, silently misclassifying every commit rather
      // than raising an actionable error (fresh-context review finding 9).
      return errorResult(`invalid "since" timestamp "${args.since}" — expected an ISO date string`);
    }
    const git = gitFactory(deps.vaultPath);
    const log = await git.log();

    const changes: NoteChange[] = [];
    for (const entry of log.all) {
      const commitDate = new Date(entry.date);
      if (Number.isNaN(commitDate.getTime()) || commitDate < since) continue;
      const parsed = parseNoteCommitHeader(entry.message);
      if (!parsed) continue;
      changes.push({
        ...(parsed.id !== undefined ? { id: parsed.id } : {}),
        type: parsed.type,
        title: parsed.title,
        classification: classify(parsed.op, parsed.statusChanged),
        commit: entry.hash,
        at: entry.date,
      });
    }

    // `log.all` is newest-first, so the first occurrence per note-key is
    // its most recent state — each affected note appears exactly once.
    const byKey = new Map<string, NoteChange>();
    for (const change of changes) {
      const key = change.id ?? `${change.type}::${change.title}`;
      if (!byKey.has(key)) byKey.set(key, change);
    }
    const deduped = [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at));

    return toResult({ changes: deduped });
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
