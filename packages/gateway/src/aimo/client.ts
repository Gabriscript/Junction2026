/**
 * Valio Aimo mock API client: price + availability for a SHORTLIST of products.
 *
 * Rules (portal-notes §2, §7): `X-API-Key` header, ≤ 1,000 ids per request (we split),
 * never poll the whole catalogue, cache responses in memory. Unknown ids come back with
 * `error: true` (price) / empty `scheduleLines` (availability) and are surfaced as such.
 * The `customer` parameter is ignored by the mock but sent anyway (real prices are customer-specific).
 */
import { z } from 'zod';
import { aimoApiConfig } from '../config.js';

export const MAX_BATCH = 1000;

const MoneySchema = z
  .object({
    value: z.number(),
    valueWithTax: z.number().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    currency: z.string().optional(),
  })
  .loose();

export const PriceProductSchema = z
  .object({
    productId: z.string(),
    quantity: z.number().optional(),
    catalogPrice: MoneySchema.nullable().optional(),
    priceWithTax: MoneySchema.nullable().optional(),
    comparisonPrice: MoneySchema.nullable().optional(),
    comparisonUnit: z.string().nullable().optional(),
    tax: z.object({ taxRate: z.number(), taxValue: z.number().optional() }).loose().nullable().optional(),
    listPrice: MoneySchema.nullable().optional(),
    netPriceFound: z.boolean().optional(),
    error: z.boolean().optional(),
  })
  .loose();
export type PriceProduct = z.infer<typeof PriceProductSchema>;

export const PriceResponseSchema = z
  .object({
    customerId: z.string().optional(),
    currency: z.string().optional(),
    pricingDate: z.string().optional(),
    products: z.array(PriceProductSchema),
  })
  .loose();
export type PriceResponse = z.infer<typeof PriceResponseSchema>;

export const ScheduleLineSchema = z
  .object({
    salesBlock: z.boolean().optional(),
    availableAmount: z.number().optional(),
    availableDate: z.string().optional(),
    salesUnit: z.string().optional(),
  })
  .loose();

export const AvailabilityProductSchema = z
  .object({
    productId: z.string(),
    closingTime: z.string().nullable().optional(),
    salesBlock: z.boolean().optional(),
    logisticModel: z.string().nullable().optional(),
    scheduleLines: z.array(ScheduleLineSchema).default([]),
  })
  .loose();
export type AvailabilityProduct = z.infer<typeof AvailabilityProductSchema>;

export const AvailabilityResponseSchema = z
  .object({
    timeNow: z.string().optional(),
    requestedDate: z.string().optional(),
    products: z.array(AvailabilityProductSchema),
  })
  .loose();
export type AvailabilityResponse = z.infer<typeof AvailabilityResponseSchema>;

export class AimoApiError extends Error {
  override name = 'AimoApiError';
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(message);
  }
}

export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface AimoClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
  /** Cache TTL in ms (default 10 min). 0 disables caching. */
  cacheTtlMs?: number;
  now?: () => number;
}

export interface ShortlistQuery {
  productIds: readonly string[];
  requestedDate: string;
  customer: string;
}

export interface PriceResult {
  byId: Map<string, PriceProduct>;
  /** Ids the API flagged with `error: true` or did not return at all. */
  unknownIds: string[];
  currency: string;
  liveCalls: number;
}

export interface AvailabilityResult {
  byId: Map<string, AvailabilityProduct>;
  /** Ids with no schedule line (cannot be delivered currently) or not returned. */
  notDeliverableIds: string[];
  timeNow: string | null;
  liveCalls: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class AimoClient {
  private readonly fetchImpl: FetchLike;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly priceCache = new Map<string, CacheEntry<PriceProduct>>();
  private readonly availabilityCache = new Map<string, CacheEntry<AvailabilityProduct>>();
  /** Total HTTP requests made (for tests and the query-budget audit). */
  requestCount = 0;

  constructor(private readonly opts: AimoClientOptions) {
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.cacheTtlMs = opts.cacheTtlMs ?? 10 * 60 * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Build from `.env` (AIMO_API_BASE_URL, AIMO_API_KEY). Throws a clear ConfigError when the key is missing. */
  static fromEnv(extra: Partial<AimoClientOptions> = {}): AimoClient {
    return new AimoClient({ ...aimoApiConfig(), ...extra });
  }

  async price(q: ShortlistQuery): Promise<PriceResult> {
    const ids = unique(q.productIds);
    const { hits, misses } = this.lookupCache(this.priceCache, ids, q.requestedDate);
    let liveCalls = 0;
    let currency = 'EUR';
    for (const batch of chunk(misses, MAX_BATCH)) {
      const res = PriceResponseSchema.parse(await this.post('/api/price', { customer: q.customer, requestedDate: q.requestedDate, products: batch }));
      liveCalls++;
      currency = res.currency ?? currency;
      for (const p of res.products) {
        hits.set(p.productId, p);
        this.remember(this.priceCache, p.productId, q.requestedDate, p);
      }
    }
    const unknownIds = ids.filter((id) => {
      const p = hits.get(id);
      return !p || p.error === true || !p.catalogPrice || !p.tax;
    });
    return { byId: hits, unknownIds, currency, liveCalls };
  }

  async availability(q: ShortlistQuery): Promise<AvailabilityResult> {
    const ids = unique(q.productIds);
    const { hits, misses } = this.lookupCache(this.availabilityCache, ids, q.requestedDate);
    let liveCalls = 0;
    let timeNow: string | null = null;
    for (const batch of chunk(misses, MAX_BATCH)) {
      const res = AvailabilityResponseSchema.parse(
        await this.post('/api/availability', { customer: q.customer, requestedDate: q.requestedDate, products: batch }),
      );
      liveCalls++;
      timeNow = res.timeNow ?? timeNow;
      for (const p of res.products) {
        hits.set(p.productId, p);
        this.remember(this.availabilityCache, p.productId, q.requestedDate, p);
      }
    }
    const notDeliverableIds = ids.filter((id) => (hits.get(id)?.scheduleLines.length ?? 0) === 0);
    return { byId: hits, notDeliverableIds, timeNow, liveCalls };
  }

  clearCache(): void {
    this.priceCache.clear();
    this.availabilityCache.clear();
  }

  private async post(endpoint: string, body: unknown): Promise<unknown> {
    this.requestCount++;
    const res = await this.fetchImpl(`${this.opts.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-API-Key': this.opts.apiKey },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      const detail = text.length > 300 ? `${text.slice(0, 300)}…` : text;
      const hint = res.status === 401 ? ' (invalid or missing AIMO_API_KEY)' : res.status === 422 ? ' (malformed request: date, empty list or > 1000 ids)' : '';
      throw new AimoApiError(`Aimo API ${endpoint} → HTTP ${res.status}${hint}: ${detail}`, res.status, endpoint);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AimoApiError(`Aimo API ${endpoint} returned non-JSON`, res.status, endpoint);
    }
  }

  private lookupCache<T>(cache: Map<string, CacheEntry<T>>, ids: string[], date: string): { hits: Map<string, T>; misses: string[] } {
    const hits = new Map<string, T>();
    const misses: string[] = [];
    const t = this.now();
    for (const id of ids) {
      const e = cache.get(`${date}|${id}`);
      if (e && e.expiresAt > t) hits.set(id, e.value);
      else misses.push(id);
    }
    return { hits, misses };
  }

  private remember<T>(cache: Map<string, CacheEntry<T>>, id: string, date: string, value: T): void {
    if (this.cacheTtlMs <= 0) return;
    cache.set(`${date}|${id}`, { value, expiresAt: this.now() + this.cacheTtlMs });
  }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
