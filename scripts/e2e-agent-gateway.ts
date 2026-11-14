/**
 * End-to-end check: the real buyer agent talks HTTP to the real gateway (REST, signed offers,
 * policy, audit). Only the Aimo API is faked and the catalogue is the shared fixtures, so it runs
 * without an API key or data/catalogue.sqlite.
 *   npx tsx scripts/e2e-agent-gateway.ts ["I need 1,000 litres of lactose-free milk by Monday"]
 */
import { DatabaseSync } from 'node:sqlite';
import * as fx from '@junction/shared/fixtures';
import { AimoClient, type FetchLike } from '../packages/gateway/src/aimo/client.js';
import { AuditStore } from '../packages/gateway/src/audit/store.js';
import { memoryCatalogue } from '../packages/gateway/src/catalogue/store.js';
import { DEFAULT_KNOWN_AGENTS, type GatewayConfig } from '../packages/gateway/src/config.js';
import { buildServer } from '../packages/gateway/src/http/server.js';
import { OrderStore } from '../packages/gateway/src/orders/store.js';
import { GatewayService } from '../packages/gateway/src/service.js';
import { generateSigningKey } from '../packages/gateway/src/trust/keys.js';
import { runAgent } from '../packages/agent/src/agent.js';
import { HttpGateway } from '../packages/agent/src/http-client.js';
import { createProvider } from '../packages/agent/src/llm.js';

const PORT = 8799;
const PUBLIC_URL = `http://127.0.0.1:${PORT}`;
const PRICES: Record<string, number> = { '990001': 14.4, '990002': 13.2 };

/** Fake Aimo: lactose-free milk 990001 in Stock (120 crates), 990002 Terminal; delivers on the requested date. */
const fakeAimo: FetchLike = async (url, init) => {
  const body = JSON.parse(init.body) as { products: string[]; requestedDate: string };
  const isPrice = url.endsWith('/api/price');
  const products = body.products.map((id) => {
    const price = PRICES[id];
    if (isPrice) {
      if (price === undefined) return { productId: id, quantity: 1, netPriceFound: false, error: true };
      return {
        productId: id,
        quantity: 1,
        catalogPrice: { value: price, valueWithTax: price * 1.135, validFrom: '2026-06-01T00:00:00+0300', validTo: '2026-12-31T00:00:00+0200', currency: 'EUR' },
        comparisonPrice: { value: 1.2, valueWithTax: 1.36 },
        comparisonUnit: 'L',
        tax: { taxRate: 13.5, taxValue: price * 0.135 },
        netPriceFound: false,
        error: false,
      };
    }
    if (price === undefined) return { productId: id, salesBlock: false, scheduleLines: [] };
    const stock = id === '990001';
    return {
      productId: id,
      closingTime: `${body.requestedDate}T00:00:00+0200`,
      salesBlock: false,
      logisticModel: stock ? 'Stock' : 'Terminal',
      scheduleLines: [{ salesBlock: false, availableAmount: stock ? 120 : 999999, availableDate: body.requestedDate, salesUnit: 'KI' }],
    };
  });
  const payload = isPrice
    ? { customerId: '123', currency: 'EUR', pricingDate: `${body.requestedDate}T00:00:00+0200`, products }
    : { timeNow: new Date().toISOString(), requestedDate: `${body.requestedDate}T00:00:00+0200`, products };
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
};

const config: GatewayConfig = { port: PORT, host: '127.0.0.1', publicUrl: PUBLIC_URL, offerTtlMinutes: 30, knownAgents: DEFAULT_KNOWN_AGENTS, policyVersion: 'policy-0.1' };
const key = (await generateSigningKey()).key;
const db = new DatabaseSync(':memory:');
const audit = new AuditStore(db, () => new Date());
const service = new GatewayService({
  catalogue: memoryCatalogue(fx.products),
  aimo: new AimoClient({ baseUrl: 'https://aimo.fake', apiKey: 'fake', fetch: fakeAimo }),
  key,
  audit,
  orders: new OrderStore(db),
  config,
  now: () => new Date(),
});
const app = await buildServer({ service, audit, key, mcp: false });
await app.listen({ port: PORT, host: '127.0.0.1' });

try {
  const text = process.argv.slice(2).join(' ') || 'I need 1,000 litres of lactose-free milk by Monday';
  // the trust root is configuration: the issuer the gateway names and the JWKS URL it publishes
  const jwksUrl = `${PUBLIC_URL}/.well-known/jwks.json`;
  const result = await runAgent(text, {
    llm: createProvider({ LLM_PROVIDER: 'none' }),
    gateway: new HttpGateway(PUBLIC_URL),
    now: () => new Date(),
    trust: { issuer: jwksUrl, jwks: new URL(jwksUrl) },
    mandate: { ...fx.hotelMandate, validUntil: '2099-01-01T00:00:00+02:00' },
  });
  for (const [i, step] of result.trace.entries()) console.log(`${i + 1}. ${step.action}: ${step.output}`);
  console.log(`\nDecision: ${result.status} (${result.decision.reasonCodes.join(', ') || 'no reason codes'})${result.order ? `, order ${result.order.orderId}` : ''}`);
  const chain = audit.verifyChain();
  console.log(`Audit chain: ${chain.ok ? 'ok' : 'BROKEN'}, ${chain.length} events`);
  if (!result.order || !chain.ok) process.exitCode = 1;
} finally {
  await app.close();
  db.close();
}
