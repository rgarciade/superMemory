import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SyncEngine } from "../../sync/engine.js";
import type { EngineState } from "../../sync/state.js";

/**
 * `status` — engine visibility (tool-catalog spec: "sync and status —
 * engine visibility"). P3 wiring (task 3.13): the handler returns the
 * REAL engine's state snapshot (design §7) — last successful sync,
 * pending writes, open conflicts, stale notes, format version,
 * push-paused, lock owner. The P2 stub (and its `note` disclosure
 * field) is gone: there is no stub to disclose.
 */

export interface StatusDeps {
  engine: SyncEngine;
}

export function createStatusHandler(deps: StatusDeps) {
  return (): CallToolResult => toResult(deps.engine.state());
}

function toResult(payload: EngineState): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    // Spread into a fresh object literal: anonymous shapes carry implicit
    // index signatures (interfaces don't), so no cast is needed.
    structuredContent: { ...payload },
  };
}
