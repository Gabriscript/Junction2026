/**
 * Fastify REST binding: the 7 tools from the shared registry, OpenAPI at /docs (generated from
 * the Zod schemas), JWKS, audit views + SSE stream, and the MCP streamable-HTTP endpoint at /mcp.
 */
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AuditEventSchema, OrderSchema, OrderStatusSchema, TOOLS, type AuditEvent, type ToolDefinition } from '@junction/shared';
import type { AuditStore } from '../audit/store.js';
import { jwksFor, type SigningKey } from '../trust/keys.js';
import { GatewayError, type GatewayService } from '../service.js';
import { createMcpHttpHandler } from '../mcp/server.js';

export interface HttpDeps {
  service: GatewayService;
  audit: AuditStore;
  key: SigningKey;
  /** Mount the MCP streamable-HTTP transport at /mcp (default true). */
  mcp?: boolean;
}

const ErrorSchema = z.object({ error: z.string(), code: z.string(), message: z.string() }).describe('Error');

/** Split a tool's input schema into path params (`{name}` in the route) and the body. */
function pathParamNames(tool: ToolDefinition): string[] {
  return [...tool.http.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
}

export async function buildServer(deps: HttpDeps): Promise<FastifyInstance> {
  const { service, audit } = deps;
  const app = Fastify({ logger: process.env['GATEWAY_LOG'] === '1' }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cors, { origin: true });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Valio Aimo Agent Commerce Gateway',
        version: '0.1.0',
        description:
          'Aimo Agent Commerce Protocol v0.1: catalogue search, signed fixed-price offers (JWS ES256, keys at /.well-known/jwks.json), ' +
          'mandate-checked order proposals with reason codes, human approval, hash-chained audit. approve/reject are human-only (not exposed over MCP).',
      },
      tags: [
        { name: 'agent', description: 'Tools an AI purchasing agent may call (also exposed over MCP at /mcp)' },
        { name: 'human', description: 'Human-only tools for the approval app' },
        { name: 'trust', description: 'Keys and audit' },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof GatewayError) {
      return reply.status(err.status).send({ error: err.name, code: err.code, message: err.message });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({ error: 'ValidationError', code: 'INVALID_INPUT', message: err.validation.map((v) => `${v.instancePath || '/'} ${v.message}`).join('; ') });
    }
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'ValidationError', code: 'INVALID_INPUT', message: z.prettifyError(err) });
    }
    const e = err as { statusCode?: number; code?: string; name?: string; message?: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: e.name ?? 'Error', code: e.code ?? 'INTERNAL', message: status >= 500 ? 'Internal error' : (e.message ?? 'Error') });
  });

  // ---------------------------------------------------------------- the 7 tools
  const handlers: { [K in keyof typeof TOOLS]: (input: never) => unknown } = {
    search_products: (i) => service.searchProducts(i),
    get_offers: (i) => service.getOffers(i),
    propose_order: async (i) => ({ order: await service.proposeOrder(i) }),
    approve_order: (i) => ({ order: service.approveOrder(i) }),
    reject_order: (i) => ({ order: service.rejectOrder(i) }),
    get_order: (i: { orderId: string }) => ({ order: service.getOrder(i.orderId) }),
    explain: (i: { orderId: string }) => service.explain(i.orderId),
  };

  for (const tool of Object.values(TOOLS) as ToolDefinition[]) {
    const params = pathParamNames(tool);
    const url = tool.http.path.replace(/\{(\w+)\}/g, ':$1');
    const bodySchema = params.length ? tool.input.omit(Object.fromEntries(params.map((p) => [p, true as const])) as Record<string, true>) : tool.input;
    const paramsSchema = params.length ? z.object(Object.fromEntries(params.map((p) => [p, z.string().min(1)]))) : undefined;
    const bodyHasFields = Object.keys(bodySchema.shape).length > 0;
    const handler = async (req: FastifyRequest, reply: FastifyReply) => {
      const input = { ...((req.body as object) ?? {}), ...((req.params as object) ?? {}) };
      const out = await (handlers[tool.name] as (i: unknown) => unknown)(input);
      return reply.status(tool.mutating && tool.http.method === 'POST' ? 201 : 200).send(out);
    };
    app.route({
      method: tool.http.method,
      url,
      schema: {
        operationId: tool.name,
        summary: tool.title,
        description: tool.description + (tool.humanOnly ? ' HUMAN ONLY: not available to agents / over MCP.' : ''),
        tags: [tool.humanOnly ? 'human' : 'agent'],
        ...(paramsSchema ? { params: paramsSchema } : {}),
        ...(tool.http.method === 'POST' && bodyHasFields ? { body: bodySchema } : {}),
        response: { 200: tool.output, 201: tool.output, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema, 429: ErrorSchema },
      },
      handler,
    });
  }

  // ---------------------------------------------------------------- trust + audit
  app.get('/.well-known/jwks.json', { schema: { tags: ['trust'], summary: 'Offer verification keys (JWKS)', response: { 200: z.object({ keys: z.array(z.record(z.string(), z.unknown())) }) } } }, async () => jwksFor(deps.key));

  const AuditQuery = z.object({
    view: z.enum(['buyer', 'aimo']).default('aimo'),
    customerRef: z.string().min(1).optional(),
    orderId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
  });
  app.get('/v1/audit', { schema: { tags: ['trust'], summary: 'Audit events (buyer view needs customerRef)', querystring: AuditQuery, response: { 200: z.object({ events: z.array(AuditEventSchema) }), 400: ErrorSchema } } }, async (req) => {
    const q = req.query;
    if (q.orderId) return { events: audit.forOrder(q.orderId) };
    if (q.view === 'buyer') {
      if (!q.customerRef) throw new GatewayError(400, 'INVALID_INPUT', 'buyer view requires customerRef');
      return { events: audit.list({ view: 'buyer', customerRef: q.customerRef }, q.limit) };
    }
    return { events: audit.list({ view: 'aimo' }, q.limit) };
  });
  app.get('/v1/audit/verify', { schema: { tags: ['trust'], summary: 'Re-verify the whole hash chain', response: { 200: z.object({ ok: z.boolean(), length: z.number(), firstBroken: z.number(), problem: z.string().optional() }) } } }, async () => audit.verifyChain());

  app.get('/v1/orders', { schema: { tags: ['human'], summary: 'List orders (approval queue)', querystring: z.object({ customerRef: z.string().optional(), status: OrderStatusSchema.optional() }), response: { 200: z.object({ orders: z.array(OrderSchema) }) } } }, async (req) => ({
    orders: service.listOrders(req.query),
  }));

  /** SSE stream of audit events. Buyer view when `view=buyer&customerRef=…`. */
  app.get('/v1/audit/stream', { schema: { tags: ['trust'], summary: 'Server-sent events: live audit stream', querystring: AuditQuery.pick({ view: true, customerRef: true }), hide: false } }, (req, reply) => {
    const q = req.query;
    const visible = (e: AuditEvent) => q.view !== 'buyer' || (e.customerRef === q.customerRef && e.visibility.includes('buyer'));
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ chain: audit.count() })}\n\n`);
    const listener = (e: AuditEvent) => {
      if (visible(e)) reply.raw.write(`event: audit\nid: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    audit.on('event', listener);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      audit.off('event', listener);
    });
  });

  app.get('/health', { schema: { tags: ['trust'], summary: 'Health', response: { 200: z.object({ status: z.literal('ok'), chain: z.number(), now: z.string() }) } } }, async () => ({ status: 'ok' as const, chain: audit.count(), now: new Date().toISOString() }));

  // ---------------------------------------------------------------- MCP over streamable HTTP
  if (deps.mcp !== false) {
    const mcp = createMcpHttpHandler(service);
    app.route({
      method: ['GET', 'POST', 'DELETE'],
      url: '/mcp',
      schema: { hide: true },
      handler: async (req, reply) => {
        const res = await mcp(req);
        reply.status(res.status).headers(res.headers);
        return reply.send(res.body ?? undefined);
      },
    });
  }

  return app;
}
