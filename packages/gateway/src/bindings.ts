/**
 * Transport bindings derived from the shared tool registry.
 * Step 6 wires these into Fastify (REST + OpenAPI) and the MCP server; keeping the
 * derivation here means both transports always expose exactly the contract.
 */
import { AGENT_TOOLS, TOOL_LIST, type ToolDefinition } from '@junction/shared';
import { z } from 'zod';

/** Shape `@modelcontextprotocol/sdk` expects when listing tools. */
export interface McpToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean };
}

export function mcpToolDescriptors(tools: readonly ToolDefinition[] = AGENT_TOOLS): McpToolDescriptor[] {
  return tools
    .filter((t) => !t.humanOnly)
    .map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>,
      outputSchema: z.toJSONSchema(t.output) as Record<string, unknown>,
      annotations: { readOnlyHint: !t.mutating },
    }));
}

export interface RestRoute {
  tool: ToolDefinition['name'];
  method: 'GET' | 'POST';
  /** Fastify-style path, e.g. `/v1/orders/:orderId`. */
  url: string;
}

export function restRoutes(tools: readonly ToolDefinition[] = TOOL_LIST): RestRoute[] {
  return tools.map((t) => ({
    tool: t.name,
    method: t.http.method,
    url: t.http.path.replace(/\{(\w+)\}/g, ':$1'),
  }));
}
