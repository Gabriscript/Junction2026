import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AimoApiError, AimoClient, chunk, MAX_BATCH, type FetchLike } from './client.js';

interface Recorded {
  endpoint: string;
  request: { products: string[] };
  status: number;
  body: unknown;
}
const load = (name: string): Recorded => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Recorded;
const priceFx = load('price');
const availFx = load('availability');

/** Replays the recorded fixtures; records every request body it sees. */
function fakeFetch(calls: { url: string; body: { products: string[] } }[], status = 200): FetchLike {
  return async (url, init) => {
    const body = JSON.parse(init.body) as { products: string[] };
    calls.push({ url, body });
    if (status !== 200) return { ok: false, status, text: async () => JSON.stringify({ detail: 'Invalid or missing API key' }) };
    const fx = url.endsWith('/api/price') ? priceFx : availFx;
    // Echo only the requested ids back, like the real API.
    const products = (fx.body as { products: { productId: string }[] }).products.filter((p) => body.products.includes(p.productId));
    return { ok: true, status: 200, text: async () => JSON.stringify({ ...(fx.body as object), products }) };
  };
}

const q = { productIds: priceFx.request.products, requestedDate: '2026-11-17', customer: '123' };

describe('AimoClient', () => {
  it('parses recorded price responses and surfaces unknown ids', async () => {
    const calls: { url: string; body: { products: string[] } }[] = [];
    const c = new AimoClient({ baseUrl: 'https://mock.test', apiKey: 'test-key', fetch: fakeFetch(calls) });
    const r = await c.price(q);
    expect(calls[0]!.url).toBe('https://mock.test/api/price');
    expect(r.unknownIds).toEqual(['000000']);
    expect(r.byId.get('000000')?.error).toBe(true);
    const p = r.byId.get('464073')!;
    expect(p.catalogPrice?.value).toBeGreaterThan(0);
    expect(p.tax?.taxRate).toBe(13.5);
    expect(p.comparisonUnit).toBe('L');
    expect(r.currency).toBe('EUR');
  });

  it('parses recorded availability and surfaces non-deliverable ids', async () => {
    const c = new AimoClient({ baseUrl: 'https://mock.test', apiKey: 'test-key', fetch: fakeFetch([]) });
    const r = await c.availability(q);
    expect(r.notDeliverableIds).toEqual(['000000']);
    const a = r.byId.get('462775')!;
    expect(a.logisticModel).toBe('Stock');
    expect(a.scheduleLines).toHaveLength(1);
    expect(a.scheduleLines[0]!.availableDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.timeNow).toBeTruthy();
  });

  it('sends the API key header and caches per date (no repeat live calls)', async () => {
    const calls: { url: string; body: { products: string[] } }[] = [];
    let seenKey = '';
    const inner = fakeFetch(calls);
    const c = new AimoClient({
      baseUrl: 'https://mock.test',
      apiKey: 'test-key',
      fetch: (u, i) => {
        seenKey = i.headers['X-API-Key']!;
        return inner(u, i);
      },
    });
    const a = await c.price(q);
    const b = await c.price(q);
    expect(seenKey).toBe('test-key');
    expect(a.liveCalls).toBe(1);
    expect(b.liveCalls).toBe(0);
    expect(c.requestCount).toBe(1);
    // A different date is a different cache key.
    await c.price({ ...q, requestedDate: '2026-11-18' });
    expect(c.requestCount).toBe(2);
    // Partially cached shortlist only fetches the misses.
    await c.price({ ...q, productIds: [...q.productIds, '999999'] });
    expect(calls.at(-1)!.body.products).toEqual(['999999']);
  });

  it('splits a shortlist > 1,000 ids into batches of ≤ 1,000', async () => {
    const calls: { url: string; body: { products: string[] } }[] = [];
    const c = new AimoClient({ baseUrl: 'https://mock.test', apiKey: 'k', fetch: fakeFetch(calls), cacheTtlMs: 0 });
    const ids = Array.from({ length: 2345 }, (_, i) => String(100000 + i));
    const r = await c.availability({ productIds: ids, requestedDate: '2026-11-17', customer: '1' });
    expect(r.liveCalls).toBe(3);
    expect(calls.map((x) => x.body.products.length)).toEqual([1000, 1000, 345]);
    expect(calls.every((x) => x.body.products.length <= MAX_BATCH)).toBe(true);
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it('fails fast with a clear message when the key is missing or rejected', async () => {
    const saved = process.env['AIMO_API_KEY'];
    process.env['AIMO_API_KEY'] = '';
    try {
      expect(() => AimoClient.fromEnv()).toThrow(/Missing AIMO_API_KEY/);
    } finally {
      if (saved === undefined) delete process.env['AIMO_API_KEY'];
      else process.env['AIMO_API_KEY'] = saved;
    }
    const c = new AimoClient({ baseUrl: 'https://mock.test', apiKey: 'bad', fetch: fakeFetch([], 401) });
    await expect(c.price(q)).rejects.toThrow(AimoApiError);
    await expect(c.price(q)).rejects.toThrow(/HTTP 401 \(invalid or missing AIMO_API_KEY\)/);
  });
});
