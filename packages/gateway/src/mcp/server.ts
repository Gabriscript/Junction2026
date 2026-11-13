/**
 * MCP binding: the 5 agent tools from the shared registry (never approve/reject).
 * Same `GatewayService` as REST. Transports: stdio (`mcp/stdio.ts`) and streamable HTTP (`/mcp`).
 */
import { Readable } from 'node:stream';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { FastifyRequest } from 'fastify';
import { AGENT_TOOLS, type ToolDefinition, type ToolName } from '@junction/shared';
import { GatewayError, type GatewayService } from '../service.js';

type Handler = (input: never) => unknown | Promise<unknown>;

export function toolHandlers(service: GatewayService): Record<ToolName, Handler> {
  return {
    search_products: (i) => service.searchProducts(i),
    get_offers: (i) => service.getOffers(i),
    propose_order: async (i) => ({ order: await service.proposeOrder(i) }),
    approve_order: () => {
      throw new GatewayError(403, 'HUMAN_ONLY', 'approve_order is human-only and not available over MCP');
    },
    reject_order: () => {
      throw new GatewayError(403, 'HUMAN_ONLY', 'reject_order is human-only and not available over MCP');
    },
    get_order: (i: { orderId: string }) => ({ order: service.getOrder(i.orderId) }),
    explain: (i: { orderId: string }) => service.explain(i.orderId),
  };
}

export function buildMcpServer(service: GatewayService): McpServer {
  const server = new McpServer(
    { name: 'valio-aimo-gateway', version: '0.1.0' },
    { instructions: 'Valio Aimo agent commerce gateway. Flow: search_products (local catalogue) → get_offers (signed, shortlist only) → propose_order (under a buyer mandate) → get_order / explain. Approvals are done by humans in the approval app, never via MCP.' },
  );
  const handlers = toolHandlers(service);
  for (const tool of AGENT_TOOLS as readonly ToolDefinition[]) {
    if (tool.humanOnly) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        outputSchema: tool.output,
        annotations: { readOnlyHint: !tool.mutating, destructiveHint: false, openWorldHint: tool.name === 'get_offers' },
      },
      async (args: unknown) => {
        try {
          const out = (await (handlers[tool.name] as (i: unknown) => unknown)(args)) as Record<string, unknown>;
          return { content: [{ type: 'text' as const, text: JSON.stringify(out) }], structuredContent: out };
        } catch (e) {
          const err = e as GatewayError;
          const payload = { error: err.name ?? 'Error', code: err.code ?? 'INTERNAL', message: err.message };
          return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], isError: true };
        }
      },
    );
  }
  return server;
}

/**
 * Stateless streamable-HTTP handler: a fresh server + transport per request (no sessions),
 * which is enough for Claude Desktop / Inspector style clients and keeps the gateway restart-safe.
 */
export interface McpHttpResult {
  status: number;
  headers: Record<string, string>;
  body: Readable | null;
}

export function createMcpHttpHandler(service: GatewayService): (req: FastifyRequest) => Promise<McpHttpResult> {
  return async (req) => {
    const url = `http://${req.headers.host ?? 'localhost'}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(', '));
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null;
    const body = hasBody ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined;
    const request = new Request(url, { method: req.method, headers, ...(body ? { body } : {}) });

    const server = buildMcpServer(service);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const res = await transport.handleRequest(request, hasBody ? { parsedBody: JSON.parse(body!) } : undefined);
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      outHeaders[k] = v;
    });
    // Close the per-request server once the response body has been consumed.
    if (res.body) {
      const nodeStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
      nodeStream.once('close', () => void server.close());
      return { status: res.status, headers: outHeaders, body: nodeStream };
    }
    await server.close();
    return { status: res.status, headers: outHeaders, body: null };
  };
}
