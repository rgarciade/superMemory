import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildEngineStateStub, type StatusDeps } from "./status.js";

/**
 * `sync` — trigger a sync cycle and return the resulting status
 * (tool-catalog spec). P2 ships a documented stub: no engine exists yet
 * (P3), so there is no cycle to run — the "resulting status" is today's
 * computed status (same shape `status` returns), matching design §5.3's
 * P2 permission ("documented stubs ... no schema change when P3 wires
 * the real engine").
 */

export function createSyncHandler(deps: StatusDeps) {
  return (): CallToolResult => toResult(buildEngineStateStub(deps));
}

function toResult(payload: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}
