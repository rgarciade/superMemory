import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

/**
 * Test-only helper (design §5.4): registers one or more tools on a real
 * `McpServer`, connects it to a real SDK `Client` over
 * `InMemoryTransport.createLinkedPair()`, and returns the connected client.
 * This is the closest hermetic approximation of a real MCP client —
 * exercises the real serialization + zod-schema path without spawning a
 * process. Used by each tool's own contract test (2.11-2.15) ahead of the
 * full composed server (2.16); the 2.18 phase-gate suite exercises the
 * real `server.ts` composition instead of this helper.
 */

export interface TestToolRegistration {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny> | z.ZodTypeAny;
  handler: (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;
}

export interface ToolTestClient {
  client: Client;
  close(): Promise<void>;
}

export async function createToolTestClient(
  tools: TestToolRegistration[],
): Promise<ToolTestClient> {
  const server = new McpServer({ name: "supermemory-test", version: "0.0.0" });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema as never },
      tool.handler as never,
    );
  }

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "supermemory-test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
