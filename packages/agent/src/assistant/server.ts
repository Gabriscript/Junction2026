/**
 * Assistant server: the buyer-side backend behind the "Order with AI Assistant" screens.
 *
 *   chef text ──► planMenu (dishes → shopping list) ──► runAgent once per ingredient ──► real gateway
 *
 * Buyer side only: it talks to the Valio Aimo gateway over its public REST API, exactly like any
 * outside agent would. Endpoints used by packages/ui (via the Vite dev proxy):
 *   POST /api/menu      { text }  → { plan, lines[] }   plan + one decision per ingredient
 *   POST /api/requests  { text }  → Order               most relevant order (for the old single-order UI)
 *   GET  /api/orders              → Order[]             this kitchen's orders (gateway /v1/orders)
 *   GET  /api/audit?scope=…       → AuditEvent[]        buyer or Aimo view (gateway /v1/audit)
 *   GET  /api/events              → SSE                 live audit events, unnamed frames for EventSource
 *
 * Run: GATEWAY_URL=http://localhost:8787 npm run assistant -w @junction/agent  (port 8788)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SubstitutionPolicySchema, type Mandate, type Order } from '@junction/shared';
import { hotelMandate } from '@junction/shared/fixtures';
import { runAgent, type AgentResult } from '../agent.js';
import { HttpGateway } from '../http-client.js';
import { addDays, createProvider, todayIso } from '../llm.js';
import { planMenu, RecipeError, type MenuLine, type MenuPlan } from '../recipe/index.js';

const PORT = Number(process.env.ASSISTANT_PORT ?? 8788);
const GATEWAY = (process.env.GATEWAY_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(GATEWAY)) throw new Error('GATEWAY_URL must be https:// unless it is localhost');
// shortcut (same as the CLI): trust the JWKS of the configured gateway; pin TRUST_JWKS_URL for anything non-local
const JWKS = process.env.TRUST_JWKS_URL || `${GATEWAY}/.well-known/jwks.json`;

/** Demo restaurant for the video: the gateway's static demo agent and customer 789. */
export const bistroMandate: Mandate = {
  ...hotelMandate,
  mandateId: 'mdt_demo_bistro_1',
  customerRef: '789',
  buyer: { orgId: 'org:bistro-demo', name: 'Bistro Helsinki (demo)' },
  agentId: 'agent:demo-1',
  budgetLimit: 1000,
  autoApproveLimit: 80,
  forbiddenAllergens: [],
  requiredAttributes: [],
  substitutionPolicy: SubstitutionPolicySchema.parse(process.env.SUBSTITUTION_POLICY ?? 'same_category'),
};

const gateway = new HttpGateway(GATEWAY);
const trust = { issuer: JWKS, jwks: new URL(JWKS) };
const llm = createProvider();

export interface MenuLineResult {
  name: string;
  searchText: string;
  quantity: number;
  unit: MenuLine['catalogue']['unit'];
  usedIn: string[];
  optional: boolean;
  /** Gateway decision, or not_ordered when the agent stopped before proposing an order. */
  status: 'auto_approved' | 'needs_approval' | 'blocked' | 'not_ordered';
  reasonCodes: string[];
  orderId?: string;
  product?: string;
  netEur?: number;
  /** Last trace step, human readable: why the agent stopped or what it chose. */
  note: string;
  /** Offers the agent turned down (e.g. a product that cannot be delivered in time), with the reason code. */
  rejected: Array<{ productId: string; reasonCode: string }>;
}

const UNIT_WORD = { KG: 'kg', L: 'l', ST: 'pcs' } as const;

function lineText(line: MenuLine, date: string): string {
  return `${line.catalogue.quantity} ${UNIT_WORD[line.catalogue.unit]} ${line.searchText} by ${date}`;
}

function summarise(line: MenuLine, result: AgentResult): MenuLineResult {
  const last = result.trace.at(-1);
  const status: MenuLineResult['status'] = result.order ? result.decision.status : 'not_ordered';
  return {
    name: line.name,
    searchText: line.searchText,
    // what the agent understood (same as the plan for dishes; the chef's own numbers for a follow-up)
    quantity: result.need.quantity,
    unit: result.need.unit as MenuLine['catalogue']['unit'],
    usedIn: line.usedIn,
    optional: line.optional,
    status,
    reasonCodes: [...result.decision.reasonCodes],
    ...(result.order ? { orderId: result.order.orderId, netEur: result.order.totals.net } : {}),
    ...(result.chosen ? { product: result.chosen.product.name } : {}),
    note: last ? `${last.action}: ${last.output}` : '',
    rejected: result.rejected.map((r) => ({ productId: r.productId, reasonCode: r.reasonCode })),
  };
}

/** Follow-up words that are not part of the product ("add 2 kg parmesan" → "2 kg parmesan"). */
const LEAD_WORDS = /^\s*(?:please\s+)?(?:add|also|plus|and|more|aggiungi|anche|lisää|myös)\b[\s:,]*/i;

/** Demo ingredients the recipe table knows: a follow-up naming one gets the same catalogue word and category. */
const INGREDIENT_HINTS: Array<{ re: RegExp; searchText: string; category: string }> = [
  { re: /parmesan|parmigiano|parmesaani/i, searchText: 'parmigiano', category: '10600' },
  { re: /mozzarella/i, searchText: 'mozzarella', category: '10637' },
  { re: /tomat|pomodor/i, searchText: 'tomato', category: '17401' },
  { re: /oregano|origano/i, searchText: 'oregano', category: '22630' },
  { re: /fusilli/i, searchText: 'fusilli', category: '21380' },
  { re: /pesto/i, searchText: 'pesto', category: '21917' },
  { re: /ciabatta/i, searchText: 'ciabatta', category: '41760' },
  { re: /ice ?cream|gelato|jäätelö/i, searchText: 'ice cream', category: '41820' },
];

/** A single product request ("add 2 kg parmesan"): no dish, so the agent orders it directly. */
function singleLinePlan(text: string, neededBy: string | null): MenuPlan {
  let cleaned = text.replace(LEAD_WORDS, '').trim();
  const hint = INGREDIENT_HINTS.find((h) => h.re.test(cleaned));
  if (hint && hint.searchText !== 'ice cream') cleaned = cleaned.replace(hint.re, hint.searchText).replace(/\b(\w+)\w*\s+\1\b/i, '$1');
  return {
    text,
    servings: 1,
    meal: null,
    neededBy,
    dishes: [],
    lines: [
      {
        name: cleaned.replace(/^\s*[\d.,]+\s*(?:kg|g|l|litres?|liters?|pcs|kpl)?\s+/i, '') || cleaned,
        searchText: cleaned,
        kind: 'other',
        perServing: 1,
        unit: 'g',
        attributes: [],
        optional: false,
        total: 1,
        catalogue: { unit: 'KG', quantity: 1 },
        usedIn: [],
        ...(hint ? { category: hint.category } : {}),
      },
    ],
    unknownDishes: [],
    assumptions: neededBy ? [`same delivery day as your previous request (${neededBy})`] : [],
  };
}

async function planAndOrder(text: string, context: { neededBy?: string | null } = {}): Promise<{ plan: MenuPlan; lines: MenuLineResult[]; orders: Order[] }> {
  let plan: MenuPlan;
  let single = false;
  try {
    plan = await planMenu(text);
    if (!plan.neededBy && context.neededBy) {
      plan = { ...plan, neededBy: context.neededBy, assumptions: [...plan.assumptions.filter((a) => !a.startsWith('delivery date not given')), `same delivery day as your previous request (${context.neededBy})`] };
    }
  } catch (error) {
    if (!(error instanceof RecipeError)) throw error;
    // not a dish: treat the text as one product request for the agent ("add 2 kg parmesan")
    plan = singleLinePlan(text, context.neededBy ?? null);
    single = true;
  }
  const date = plan.neededBy ?? addDays(todayIso(new Date()), 1);
  const lines: MenuLineResult[] = [];
  const orders: Order[] = [];
  // one ingredient at a time: keeps the gateway's query budget and the audit trail in a readable order
  for (const line of plan.lines) {
    const request = single ? `${line.searchText} by ${date}` : lineText(line, date);
    const result = await runAgent(request, {
      llm,
      gateway,
      now: () => new Date(),
      trust,
      mandate: bistroMandate,
      ...(line.category ? { category: line.category } : {}),
      confirmUnusual: true, // a menu sets its own quantities; there is no order history for this kitchen
    });
    lines.push(summarise(line, result));
    if (result.order) orders.push(result.order);
  }
  return { plan, lines, orders };
}

// ---------------------------------------------------------------- http plumbing

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64_000) throw new HttpError(413, 'request too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function gatewayJson(path: string): Promise<any> {
  const r = await fetch(GATEWAY + path, { redirect: 'error' });
  if (!r.ok) throw new HttpError(502, `gateway answered ${r.status} for ${path}`);
  return r.json();
}

function textOf(body: unknown): string {
  const text = typeof body === 'object' && body && 'text' in body ? String((body as { text: unknown }).text).trim() : '';
  if (!text) throw new HttpError(400, 'text is required');
  if (text.length > 2000) throw new HttpError(400, 'text is too long');
  return text;
}

/** Re-emits the gateway's named `audit` SSE events as unnamed frames, which EventSource.onmessage receives. */
async function relayEvents(req: IncomingMessage, res: ServerResponse) {
  const upstream = new AbortController();
  req.on('close', () => upstream.abort());
  const r = await fetch(`${GATEWAY}/v1/audit/stream?view=aimo`, { signal: upstream.signal });
  if (!r.ok || !r.body) throw new HttpError(502, 'gateway event stream unavailable');
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        if (!/^event: audit$/m.test(frame)) continue;
        const data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
        if (data) res.write(`data: ${data}\n\n`);
      }
    }
  } catch {
    // client went away or gateway closed: just end the stream
  }
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/api/menu') {
      const body = await readJson(req);
      const ctx = typeof body === 'object' && body && 'neededBy' in body ? String((body as { neededBy: unknown }).neededBy) : null;
      const neededBy = ctx && /^\d{4}-\d{2}-\d{2}$/.test(ctx) ? ctx : null;
      const { plan, lines } = await planAndOrder(textOf(body), { neededBy });
      return send(res, 200, { plan, lines });
    }
    if (req.method === 'POST' && url.pathname === '/api/requests') {
      const { orders } = await planAndOrder(textOf(await readJson(req)));
      const pick = orders.find((o) => o.status === 'pending_approval') ?? orders.find((o) => o.decision.status === 'blocked') ?? orders[0];
      if (!pick) throw new HttpError(422, 'the agent could not place any order for this request');
      return send(res, 200, pick);
    }
    if (req.method === 'GET' && url.pathname === '/api/orders') {
      const { orders } = await gatewayJson(`/v1/orders?customerRef=${encodeURIComponent(bistroMandate.customerRef)}`);
      return send(res, 200, orders);
    }
    if (req.method === 'GET' && url.pathname === '/api/audit') {
      const view = url.searchParams.get('scope') === 'buyer' ? 'buyer' : 'aimo';
      const q = view === 'buyer' ? `view=buyer&customerRef=${encodeURIComponent(bistroMandate.customerRef)}` : 'view=aimo';
      const { events } = await gatewayJson(`/v1/audit?${q}&limit=1000`);
      return send(res, 200, events);
    }
    if (req.method === 'GET' && url.pathname === '/api/events') return await relayEvents(req, res);
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { status: 'ok', gateway: GATEWAY, mandate: bistroMandate.mandateId });
    send(res, 404, { error: 'not found' });
  } catch (error) {
    if (res.headersSent) return res.end();
    if (error instanceof HttpError) return send(res, error.status, { error: error.message });
    if (error instanceof RecipeError) return send(res, 422, { error: error.message, code: error.code });
    if (error instanceof SyntaxError) return send(res, 400, { error: 'invalid JSON' });
    console.error(error);
    send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`assistant server on http://127.0.0.1:${PORT} → gateway ${GATEWAY} (mandate ${bistroMandate.mandateId}, customer ${bistroMandate.customerRef})`);
});
