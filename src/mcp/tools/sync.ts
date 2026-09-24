import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SyncEngine } from "../../sync/engine.js";
import type { EngineState } from "../../sync/state.js";

/**
 * `sync` — trigger a sync cycle immediately and return the resulting
 * status (tool-catalog spec: "Sync tool completes a full cycle";
 * design §5.3: `engine.runCycle('tool')` → resulting status). P3 wiring
 * (task 3.13): the P2 stub is gone — this is the same ONE code path the
 * CLI and the scheduler drive. No wire schema change: the result fields
 * are exactly the engine's status shape (the stub-only `note`
 * disclosure field is gone because there is no stub).
 */

export interface SyncToolDeps {
  engine: SyncEngine;
}

export function createSyncHandler(deps: SyncToolDeps) {
  return async (): Promise<CallToolResult> => {
    try {
      const report = await deps.engine.runCycle("tool");
      // Blocked writes are reported TO THE WRITER in the tool result
      // (design §4.6: "tool result / CLI") — a silently pending write
      // would leave the agent unable to remediate. The status fields
      // stay the same shape; this uses the error envelope only.
      if (report.blocked.length > 0) {
        const listing = report.blocked
          .map((blocked) => `${blocked.code} ${blocked.path}: ${blocked.message}`)
          .join("\n");
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `sync blocked ${report.blocked.length} write(s) — nothing was committed:\n${listing}`,
            },
          ],
        };
      }
      return toResult(deps.engine.state());
    } catch (err) {
      // The engine reports expected outcomes (conflict, locked, push
      // failure…) as reports; a throw here is an unexpected failure —
      // surface it as an error result naming the cause.
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  };
}

function toResult(payload: EngineState): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: { ...payload },
  };
}
