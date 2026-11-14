/**
 * One-off: price + availability of the demo kitchen's real Aimo products, for the offline UI demo.
 * Reads AIMO_API_KEY from .env through the gateway client (never printed). Prints JSON to stdout.
 * Usage: npx tsx scripts/fetch-demo-prices.ts [customer] [YYYY-MM-DD]
 */
import { AimoClient } from '../packages/gateway/src/aimo/client.js';
import { AIMO_PRODUCTS } from '../packages/ui/src/aimoProducts.js';

const customer = process.argv[2] ?? '300';
const requestedDate = process.argv[3] ?? '2026-11-16';
const ids = Object.values(AIMO_PRODUCTS).map((p) => p.productId);
const client = AimoClient.fromEnv({ cacheTtlMs: 0 });
const [price, avail] = await Promise.all([client.price({ productIds: ids, requestedDate, customer }), client.availability({ productIds: ids, requestedDate, customer })]);
const out = Object.fromEntries(
  Object.entries(AIMO_PRODUCTS).map(([item, p]) => {
    const pr = price.byId.get(p.productId);
    const av = avail.byId.get(p.productId);
    return [item, { productId: p.productId, net: pr?.catalogPrice?.value ?? null, gross: pr?.catalogPrice?.valueWithTax ?? null, taxRate: pr?.tax?.taxRate ?? null, availableDate: av?.scheduleLines[0]?.availableDate ?? null, error: pr?.error ?? false }];
  }),
);
console.log(JSON.stringify({ customer, requestedDate, unknown: price.unknownIds, notDeliverable: avail.notDeliverableIds, products: out }, null, 1));
