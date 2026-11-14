import { hotelMandate } from '@junction/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { runAgent } from './agent.js';
import { MockGateway } from './gateway.js';
import { GatewayHttpError, HttpGateway, type FetchLike } from './http-client.js';
import { createProvider } from './llm.js';

const NOW = new Date('2026-11-13T18:00:00Z');
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });

describe('HttpGateway', () => {
  it('takes method and path from the registry and keeps path params out of the body', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body });
      return reply(200, { order: {} });
    };
    const gateway = new HttpGateway('http://gw.test/', fetch);
    await gateway.get_order({ orderId: 'ord/1' });
    await gateway.approve_order({ orderId: 'ord_2', approver: { type: 'human', id: 'user:chef' } });
    expect(calls).toEqual([
      { url: 'http://gw.test/v1/orders/ord%2F1', method: 'GET', body: undefined },
      { url: 'http://gw.test/v1/orders/ord_2/approve', method: 'POST', body: JSON.stringify({ approver: { type: 'human', id: 'user:chef' } }) },
    ]);
  });

  it('turns an error answer into a GatewayHttpError with the gateway code', async () => {
    const gateway = new HttpGateway('http://gw.test', async () => reply(422, { error: 'GatewayError', code: 'OFFER_EXPIRED', message: 'Offer expired' }));
    const error = await gateway.get_order({ orderId: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayHttpError);
    expect(error).toMatchObject({ status: 422, code: 'OFFER_EXPIRED' });
  });

  it('runs the agent end to end over HTTP (routes served by the in-memory mock)', async () => {
    const mock = new MockGateway({ now: () => NOW });
    const routes: Record<string, (body: any) => Promise<unknown>> = {
      'POST /v1/products/search': (b) => mock.search_products(b),
      'POST /v1/offers': (b) => mock.get_offers(b),
      'POST /v1/orders': (b) => mock.propose_order(b),
    };
    const fetch: FetchLike = async (url, init) => reply(200, await routes[`${init.method} ${new URL(url).pathname}`]!(JSON.parse(init.body ?? '{}')));
    const result = await runAgent('I need 1,000 litres of lactose-free milk by Monday', {
      llm: createProvider({ LLM_PROVIDER: 'none' }),
      gateway: new HttpGateway('http://gw.test', fetch),
      now: () => NOW,
      trust: { issuer: 'mock-gateway', jwks: await mock.getJwks() },
      mandate: hotelMandate,
    });
    expect(result).toMatchObject({ ordered: true, status: 'auto_approved' });
  });
});

describe('HttpGateway hardening', () => {
  it('refuses dot-segment ids, refuses redirects, and reports a non-JSON body', async () => {
    const seen: string[] = [];
    const gateway = new HttpGateway('http://gw.test', async (_url, init) => {
      seen.push(init.redirect);
      return { ok: true, status: 200, json: async () => JSON.parse('<html>') };
    });
    await expect(gateway.get_order({ orderId: '..' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(gateway.get_order({ orderId: 'ord_1' })).rejects.toMatchObject({ code: 'INVALID_JSON' });
    expect(seen).toEqual(['error']);
  });
});
