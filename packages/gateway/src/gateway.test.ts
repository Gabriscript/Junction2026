/**
 * Integration: REST happy path (search → get_offers → propose_order → get_order/explain), human
 * approval, blocked allergen path, JWKS, audit views + chain, MCP tool listing and calls — all
 * against an in-memory catalogue (shared fixtures) and a fake Aimo API shaped like the recorded fixtures.
 */
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fx from '@junction/shared/fixtures';
import { OrderSchema, type GetOffersOutput, type Order, type OrderProposal } from '@junction/shared';
import { AimoClient, type FetchLike } from './aimo/client.js';
import { AuditStore } from './audit/store.js';
import { memoryCatalogue } from './catalogue/store.js';
import { DEFAULT_KNOWN_AGENTS, type GatewayConfig } from './config.js';
import { buildServer } from './http/server.js';
import { buildMcpServer } from './mcp/server.js';
import { OrderStore } from './orders/store.js';
import { GatewayService } from './service.js';
import { generateSigningKey, type SigningKey } from './trust/keys.js';
import { verifyOfferJws } from './trust/offers.js';

/** Fake Aimo mock: Stock for milk (990001, 120 KI), Terminal for 990002, bread 25 of 40, muesli later date, 990005 no price. */
const fakeAimo: FetchLike = async (url, init) => {
  const body = JSON.parse(init.body) as { products: string[]; requestedDate: string };
  const isPrice = url.endsWith('/api/price');
  const products = body.products.map((id) => {
    if (isPrice) {
      if (id === '990005' || !id.startsWith('99')) return { productId: id, quantity: 1, netPriceFound: false, error: true };
      const price = { '990001': 14.4, '990002': 13.2, '990003': 18.9, '990004': 31.5 }[id] ?? 10;
      return {
        productId: id,
        quantity: 1,
        catalogPrice: { value: price, valueWithTax: price * 1.135, validFrom: '2026-06-01T00:00:00+0300', validTo: '2026-12-31T00:00:00+0200', currency: 'EUR' },
        comparisonPrice: id.startsWith('9900') ? { value: 1.2, valueWithTax: 1.36 } : null,
        comparisonUnit: id === '990001' || id === '990002' ? 'L' : 'KG',
        tax: { taxRate: 13.5, taxValue: price * 0.135 },
        listPrice: { value: price * 1.1, validFrom: '2026-05-01T00:00:00+0300', validTo: '9999-12-31T00:00:00+0200', currency: 'EUR' },
        netPriceFound: id === '990001',
        error: false,
      };
    }
    const line = (amount: number, date = '2026-11-16') => ({ salesBlock: false, availableAmount: amount, availableDate: date, salesUnit: 'KI' });
    switch (id) {
      case '990001':
        return { productId: id, closingTime: '2026-11-15T17:00:00+0200', salesBlock: false, logisticModel: 'Stock', scheduleLines: [line(120)] };
      case '990002':
        return { productId: id, closingTime: '2026-11-15T12:00:00+0200', salesBlock: false, logisticModel: 'Terminal', scheduleLines: [line(999999)] };
      case '990003':
        return { productId: id, closingTime: '2026-11-15T17:00:00+0200', salesBlock: false, logisticModel: 'Stock', scheduleLines: [line(25)] };
      case '990004':
        return { productId: id, closingTime: '2026-11-15T17:00:00+0200', salesBlock: false, logisticModel: 'Stock', scheduleLines: [line(200, '2026-11-17')] };
      default:
        return { productId: id, salesBlock: false, scheduleLines: [] };
    }
  });
  const payload = isPrice
    ? { customerId: '123', currency: 'EUR', pricingDate: `${body.requestedDate}T00:00:00+0200`, products }
    : { timeNow: '2026-11-14T09:00:00+0200', requestedDate: `${body.requestedDate}T00:00:00+0200`, products };
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
};

let app: FastifyInstance;
let service: GatewayService;
let audit: AuditStore;
let key: SigningKey;
let clock = Date.parse('2026-11-14T09:00:00+02:00');

const config: GatewayConfig = { port: 0, host: '127.0.0.1', publicUrl: 'http://localhost:8787', offerTtlMinutes: 30, knownAgents: DEFAULT_KNOWN_AGENTS, policyVersion: 'policy-0.1' };

beforeAll(async () => {
  key = (await generateSigningKey()).key;
  const db = new DatabaseSync(':memory:');
  audit = new AuditStore(db, () => new Date(clock));
  service = new GatewayService({
    catalogue: memoryCatalogue(fx.products),
    aimo: new AimoClient({ baseUrl: 'https://mock.test', apiKey: 'k', fetch: fakeAimo }),
    key,
    audit,
    orders: new OrderStore(db),
    config,
    now: () => new Date(clock),
  });
  app = await buildServer({ service, audit, key });
  await app.ready();
});
afterAll(() => app.close());

const post = (url: string, payload: unknown): Promise<InjectResponse> => app.inject({ method: 'POST', url, payload: payload as object });
const get = (url: string): Promise<InjectResponse> => app.inject({ method: 'GET', url });

describe('REST happy path', () => {
  let offers: GetOffersOutput;
  let order: Order;

  it('search_products finds lactose-free milk from the local catalogue', async () => {
    const res = await post('/v1/products/search', fx.searchMilkInput);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ products: { id: string }[] }>();
    expect(body.products.map((p) => p.id).sort()).toEqual(['990001', '990002']);
  });

  it('get_offers returns signed offers that verify against the JWKS, and surfaces unavailable ids', async () => {
    const res = await post('/v1/offers', { ...fx.getMilkOffersInput, items: [...fx.getMilkOffersInput.items, { productId: '990005', quantity: 1 }, { productId: '999999', quantity: 1 }] });
    expect(res.statusCode).toBe(200);
    offers = res.json<GetOffersOutput>();
    expect(offers.offers).toHaveLength(2);
    expect(offers.unavailable).toEqual([
      { productId: '999999', reason: 'UNKNOWN_PRODUCT' },
      { productId: '990005', reason: 'NO_PRICE' },
    ]);
    expect(offers.jwksUrl).toBe('http://localhost:8787/.well-known/jwks.json');
    const jwks = (await get('/.well-known/jwks.json')).json<{ keys: { kid: string }[] }>();
    expect(jwks.keys[0]!.kid).toBe(key.kid);
    for (const so of offers.offers) {
      const v = await verifyOfferJws(so.jws, jwks as never, { now: new Date(clock), expectOffer: so.offer });
      expect(v.ok).toBe(true);
    }
    const milk = offers.offers.find((o) => o.offer.productId === '990001')!.offer;
    expect(milk).toMatchObject({ unitPrice: 14.4, vatRate: 13.5, quantity: 84, unit: 'KI', quantityVerified: true, availableQuantity: 120, cutoffTime: '2026-11-15T17:00:00+02:00', netPriceFound: true, origin: 'FI' });
    expect(milk.totals.gross).toBeCloseTo(1372.9, 1);
    expect(offers.offers.find((o) => o.offer.productId === '990002')!.offer.quantityVerified).toBe(false);
  });

  it('propose_order with the verified-stock milk offer is auto-approved', async () => {
    const milk = offers.offers.find((o) => o.offer.productId === '990001')!;
    const proposal: OrderProposal = { ...fx.hotelProposal, lines: [{ offerId: milk.offer.offerId, offerJws: milk.jws, quantity: 84, substituteFor: null }] };
    const res = await post('/v1/orders', proposal);
    expect(res.statusCode).toBe(201);
    order = OrderSchema.parse(res.json<{ order: Order }>().order);
    expect(order.status).toBe('auto_approved');
    expect(order.decision.reasons).toEqual([]);
    expect(order.lines[0]).toMatchObject({ productId: '990001', quantity: 84, unitPrice: 14.4, offerVerified: true });
  });

  it('get_order and explain return the stored decision and its audit timeline', async () => {
    const got = await get(`/v1/orders/${order.orderId}`);
    expect(got.statusCode).toBe(200);
    expect(got.json<{ order: Order }>().order.orderId).toBe(order.orderId);
    const ex = await get(`/v1/orders/${order.orderId}/explain`);
    expect(ex.statusCode).toBe(200);
    const body = ex.json<{ headline: string; timeline: { type: string }[] }>();
    expect(body.headline).toMatch(/^Auto-approved/);
    expect(body.timeline.map((e) => e.type)).toEqual(['order_proposed', 'order_decided']);
    expect((await get('/v1/orders/nope')).statusCode).toBe(404);
  });

  it('a Terminal substitute needs approval; a human approves it via REST (201) and MCP cannot', async () => {
    const alt = offers.offers.find((o) => o.offer.productId === '990002')!;
    const res = await post('/v1/orders', { ...fx.hotelProposal, lines: [{ offerId: alt.offer.offerId, offerJws: alt.jws, quantity: 84, substituteFor: '990001' }] });
    const pending = res.json<{ order: Order }>().order;
    expect(pending.status).toBe('pending_approval');
    expect(pending.decision.reasonCodes).toEqual(['UNVERIFIED_STOCK']);
    expect((await get('/v1/orders?status=pending_approval')).json<{ orders: Order[] }>().orders.map((o) => o.orderId)).toEqual([pending.orderId]);

    const agentTry = await post(`/v1/orders/${pending.orderId}/approve`, { approver: fx.hotelAgent, comment: 'me' });
    expect(agentTry.statusCode).toBe(400); // schema: approver.type must be "human"

    const approved = await post(`/v1/orders/${pending.orderId}/approve`, { approver: fx.hotelManager, comment: 'OK, supplier is reliable.' });
    expect(approved.statusCode).toBe(201);
    expect(approved.json<{ order: Order }>().order).toMatchObject({ status: 'approved', approval: { outcome: 'approved', by: fx.hotelManager } });
    expect((await post(`/v1/orders/${pending.orderId}/reject`, { approver: fx.hotelManager, comment: 'too late' })).statusCode).toBe(409);
    expect((await get(`/v1/orders/${pending.orderId}/explain`)).json<{ headline: string }>().headline).toMatch(/^Approved by Mia/);
  });

  it('tampered offer → 422 with OFFER_SIGNATURE_INVALID; expired offer → blocked', async () => {
    const milk = offers.offers.find((o) => o.offer.productId === '990001')!;
    const [h, p, s] = milk.jws.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString()) as Record<string, unknown>;
    payload['unitPrice'] = 0.01;
    const tampered = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    const res = await post('/v1/orders', { ...fx.hotelProposal, lines: [{ offerId: milk.offer.offerId, offerJws: tampered, quantity: 84, substituteFor: null }] });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('OFFER_SIGNATURE_INVALID');

    clock += 31 * 60_000; // past the 30 min TTL
    const late = await post('/v1/orders', { ...fx.hotelProposal, lines: [{ offerId: milk.offer.offerId, offerJws: milk.jws, quantity: 84, substituteFor: null }] });
    expect(late.statusCode).toBe(422);
    expect(late.json<{ code: string }>().code).toBe('OFFER_EXPIRED');
    clock -= 31 * 60_000;
  });

  it('hospital: bread + muesli → blocked by ALLERGEN_CONFLICT (never approvable)', async () => {
    const res = await post('/v1/offers', { agentId: fx.hospitalAgent.id, customerRef: '456', items: [{ productId: '990003', quantity: 40 }, { productId: '990004', quantity: 10 }], requestedDate: '2026-11-16' });
    const hosp = res.json<GetOffersOutput>();
    expect(hosp.offers).toHaveLength(2);
    const lines = hosp.offers.map((o) => ({ offerId: o.offer.offerId, offerJws: o.jws, quantity: o.offer.quantity, substituteFor: null }));
    const blocked = (await post('/v1/orders', { ...fx.hospitalProposal, lines })).json<{ order: Order }>().order;
    expect(blocked.status).toBe('blocked');
    expect([...blocked.decision.reasonCodes].sort()).toEqual(['ALLERGEN_CONFLICT', 'DELIVERY_LATER_THAN_NEEDED', 'OVER_AUTO_LIMIT', 'PARTIAL_AVAILABILITY']);
    expect((await post(`/v1/orders/${blocked.orderId}/approve`, { approver: fx.hospitalChef })).statusCode).toBe(409);
    const ex = (await get(`/v1/orders/${blocked.orderId}/explain`)).json<{ headline: string; nextSteps: string[] }>();
    expect(ex.headline).toMatch(/^Blocked: .*may contain tree nuts/);
    expect(ex.nextSteps.join(' ')).toMatch(/allergen/);
  });

  it('unknown agent is rejected at get_offers and audited for Aimo only', async () => {
    const res = await post('/v1/offers', { ...fx.getMilkOffersInput, agentId: 'agent:rogue-1' });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ code: string }>().code).toBe('UNKNOWN_AGENT');
    const aimo = (await get('/v1/audit?view=aimo')).json<{ events: { type: string; agentId: string | null }[] }>().events;
    expect(aimo.some((e) => e.type === 'agent_rejected' && e.agentId === 'agent:rogue-1')).toBe(true);
    const buyer = (await get('/v1/audit?view=buyer&customerRef=123')).json<{ events: { type: string; customerRef: string | null }[] }>().events;
    expect(buyer.length).toBeGreaterThan(0);
    expect(buyer.every((e) => e.customerRef === '123')).toBe(true);
    expect(buyer.some((e) => e.type === 'agent_rejected')).toBe(false);
    expect((await get('/v1/audit?view=buyer')).statusCode).toBe(400);
    expect((await get('/v1/audit/verify')).json<{ ok: boolean; length: number }>()).toMatchObject({ ok: true });
    expect(audit.verifyChain().length).toBeGreaterThanOrEqual(10);
  });

  it('validation errors are 400 and OpenAPI is served with all 7 operations', async () => {
    expect((await post('/v1/offers', { agentId: 'x' })).statusCode).toBe(400);
    const spec = (await get('/docs/json')).json<{ paths: Record<string, Record<string, { operationId: string }>> }>();
    const ops = Object.values(spec.paths).flatMap((m) => Object.values(m).map((o) => o.operationId)).filter(Boolean);
    expect(ops).toEqual(expect.arrayContaining(['search_products', 'get_offers', 'propose_order', 'approve_order', 'reject_order', 'get_order', 'explain']));
    expect((await get('/health')).json<{ status: string }>().status).toBe('ok');
  });
});

describe('MCP binding', () => {
  it('lists exactly the 5 agent tools and runs search_products', async () => {
    const server = buildMcpServer(service);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientT);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['explain', 'get_offers', 'get_order', 'propose_order', 'search_products']);
    expect(tools.tools.every((t) => t.inputSchema.type === 'object')).toBe(true);
    const r = await client.callTool({ name: 'search_products', arguments: { text: 'lactose free milk', limit: 5 } });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as { products: { id: string }[] }).products.map((p) => p.id).sort()).toEqual(['990001', '990002']);
    const bad = await client.callTool({ name: 'get_order', arguments: { orderId: 'nope' } });
    expect(bad.isError).toBe(true);
    await client.close();
    await server.close();
  });

  it('serves MCP over streamable HTTP at /mcp (stateless JSON mode)', async () => {
    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    });
    expect(init.statusCode).toBe(200);
    expect(init.json<{ result: { serverInfo: { name: string } } }>().result.serverInfo.name).toBe('valio-aimo-gateway');
    const list = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ result: { tools: { name: string }[] } }>().result.tools).toHaveLength(5);
  });
});
