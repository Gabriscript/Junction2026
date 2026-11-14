import {
  canonicalJson,
  decisionStatusFor,
  REASON_CODE_INFO,
  roundEur,
  totalsFromNet,
  type Offer,
  type Order,
  type OrderLine,
  type Product,
  type ReasonCode,
  type SignedOffer,
  type ToolInput,
  type ToolOutput,
} from '@junction/shared';
import { CompactSign, exportJWK, generateKeyPair, type JSONWebKeySet } from 'jose';
import { validateInput, type GatewayClient } from './gateway-client.js';
import { addDays, todayIso } from './llm.js';

interface FixtureProduct {
  product: Product;
  price: number; // EUR per sales unit, ex VAT
  stock: number; // sales units
  leadDays: number;
  salesBlock?: boolean;
}

const milk = (
  id: string,
  name: string,
  salesUnit: string,
  litres: number,
  price: number,
  stock: number,
  extra: { attributes?: string[]; labels?: string[]; leadDays?: number; salesBlock?: boolean } = {},
): FixtureProduct => ({
  product: {
    id,
    name,
    supplier: 'Mock Dairy Oy',
    category: '90001',
    originCountry: 'FI',
    labels: extra.labels ?? [],
    attributes: extra.attributes ?? ['LACTOSE_FREE'],
    allergens: [{ code: 'AM', name: 'milk', level: 'CONTAINS' }],
    pack: { salesUnit, baseUnit: 'ST', baseUnitsPerSalesUnit: salesUnit === 'KI' ? litres : 1, netContent: { amount: litres, unit: 'L' }, comparisonUnit: 'L', allowedLotSize: 1 },
    substitutes: [],
    deliveryReliability: null,
    carbonKgCo2ePerKg: null,
  },
  price,
  stock,
  leadDays: extra.leadDays ?? 1,
  salesBlock: extra.salesBlock,
});

// Synthetic, hand-written data. Not taken from the portal data set.
export const MOCK_PRODUCTS = {
  milk1l: '990101', // regular milk, not lactose-free
  lf1l: '990102',
  lfCase12: '990103',
  lfBib10: '990104', // partial: 400 L in stock
  lfOrganic1l: '990105', // delivered in a week
  lfBlocked: '990106',
} as const;
const P = MOCK_PRODUCTS;
const FIXTURE: FixtureProduct[] = [
  milk(P.milk1l, 'Semi-skimmed milk 1 L', 'ST', 1, 0.95, 5000, { attributes: [] }),
  milk(P.lf1l, 'Lactose-free semi-skimmed milk 1 L', 'ST', 1, 1.35, 5000),
  milk(P.lfCase12, 'Lactose-free semi-skimmed milk 12 x 1 L', 'KI', 12, 14.4, 500),
  milk(P.lfBib10, 'Lactose-free milk bag-in-box 10 L', 'ST', 10, 10.5, 40),
  milk(P.lfOrganic1l, 'Lactose-free organic milk 1 L', 'ST', 1, 1.6, 5000, { labels: ['EU_ORGANIC_FARMING'], leadDays: 7 }),
  milk(P.lfBlocked, 'Lactose-free skimmed milk 1 L', 'ST', 1, 0.99, 5000, { salesBlock: true }),
];

const OFFER_TTL_MS = 15 * 60_000;
export const MOCK_ISSUER = 'mock-gateway';
const VAT_FOOD = 13.5;

export interface MockGatewayOptions {
  now?: () => Date;
  offerTtlMs?: number;
  /** Per product id: stock override, null for unknown, 'unverified' for the Terminal placeholder. */
  stock?: Record<string, number | null | 'unverified'>;
}

const sum = (lines: OrderLine[], key: 'net' | 'vat' | 'gross') => roundEur(lines.reduce((total, line) => total + line.totals[key], 0));

/**
 * In-memory stand-in for the Aimo gateway, typed by the shared tool registry. Offers are really
 * signed (ES256 over canonicalJson), so verification is real. Policy is a small subset of the real one.
 */
export class MockGateway implements GatewayClient {
  private readonly now: () => Date;
  private readonly offerTtlMs: number;
  private readonly stock: NonNullable<MockGatewayOptions['stock']>;
  private readonly keys = generateKeyPair('ES256');
  private readonly offers = new Map<string, Offer>();
  private readonly orders = new Map<string, Order>();

  constructor(options: MockGatewayOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.offerTtlMs = options.offerTtlMs ?? OFFER_TTL_MS;
    this.stock = options.stock ?? {};
  }

  /** The keys the mock "publishes". Read once at setup to build the agent's trust config, never during a run. */
  async getJwks(): Promise<JSONWebKeySet> {
    const jwk = await exportJWK((await this.keys).publicKey);
    return { keys: [{ ...jwk, kid: 'mock-1', alg: 'ES256', use: 'sig' }] };
  }

  async search_products(input: ToolInput<'search_products'>): Promise<ToolOutput<'search_products'>> {
    validateInput('search_products', input);
    const words = (input.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const products = FIXTURE.map((fixture) => fixture.product).filter(
      (product) =>
        words.every((word) => product.name.toLowerCase().includes(word)) &&
        (input.attributes ?? []).every((attribute) => product.attributes.includes(attribute)) &&
        !(input.freeFromAllergens ?? []).some((code) => product.allergens.some((a) => a.code === code && a.level !== 'FREE_FROM')),
    );
    return { products, truncated: false };
  }

  async get_offers(input: ToolInput<'get_offers'>): Promise<ToolOutput<'get_offers'>> {
    validateInput('get_offers', input);
    const { privateKey } = await this.keys;
    const now = this.now();
    const result: ToolOutput<'get_offers'> = { offers: [], unavailable: [], jwksUrl: 'mock://jwks' };
    for (const item of input.items) {
      const fixture = FIXTURE.find((candidate) => candidate.product.id === item.productId);
      if (!fixture) {
        result.unavailable.push({ productId: item.productId, reason: 'UNKNOWN_PRODUCT' });
        continue;
      }
      const { product } = fixture;
      const stock = product.id in this.stock ? (this.stock[product.id] ?? null) : fixture.stock;
      const litres = product.pack.netContent?.amount ?? 1;
      const offer: Offer = {
        offerId: `off_mock_${this.offers.size + 1}`,
        productId: product.id,
        productName: product.name,
        customerRef: input.customerRef,
        requestedDate: input.requestedDate,
        quantity: item.quantity,
        unit: product.pack.salesUnit,
        unitPrice: fixture.price,
        currency: 'EUR',
        vatRate: VAT_FOOD,
        totals: totalsFromNet(item.quantity * fixture.price, VAT_FOOD),
        comparisonPrice: { value: roundEur(fixture.price / litres), unit: 'L' },
        netPriceFound: false,
        availableQuantity: stock === 'unverified' ? 999999 : stock,
        quantityVerified: stock !== 'unverified',
        logisticModel: stock === 'unverified' ? 'Terminal' : 'Stock',
        availableDate: addDays(todayIso(now), fixture.leadDays),
        cutoffTime: null,
        salesBlock: fixture.salesBlock ?? false,
        origin: product.originCountry,
        labels: product.labels,
        validFrom: now.toISOString(),
        validUntil: new Date(now.getTime() + this.offerTtlMs).toISOString(),
        issuer: MOCK_ISSUER,
        issuedAt: now.toISOString(),
      };
      const jws = await new CompactSign(new TextEncoder().encode(canonicalJson(offer)))
        .setProtectedHeader({ alg: 'ES256', kid: 'mock-1' })
        .sign(privateKey);
      this.offers.set(offer.offerId, offer);
      result.offers.push({ offer, jws } satisfies SignedOffer);
    }
    return result;
  }

  async propose_order(input: ToolInput<'propose_order'>): Promise<ToolOutput<'propose_order'>> {
    validateInput('propose_order', input);
    const now = this.now();
    const reasons: { code: ReasonCode; lineId?: string; message: string }[] = [];
    const lines = input.lines.map((line, index): OrderLine => {
      const offer = this.offers.get(line.offerId);
      if (!offer) throw new Error(`Unknown offer ${line.offerId}`);
      const lineId = `line_${index + 1}`;
      if (Date.parse(offer.validUntil) <= now.getTime()) reasons.push({ code: 'OFFER_EXPIRED', lineId, message: `Offer ${offer.offerId} expired` });
      if (line.quantity > (offer.availableQuantity ?? 0)) reasons.push({ code: 'PARTIAL_AVAILABILITY', lineId, message: `${offer.availableQuantity ?? 0} of ${line.quantity} available` });
      return {
        lineId,
        offerId: offer.offerId,
        productId: offer.productId,
        productName: offer.productName,
        quantity: line.quantity,
        unit: offer.unit,
        unitPrice: offer.unitPrice,
        vatRate: offer.vatRate,
        totals: totalsFromNet(line.quantity * offer.unitPrice, offer.vatRate),
        availableDate: offer.availableDate,
        substituteFor: line.substituteFor,
        offerVerified: true,
      };
    });
    const totals = { net: sum(lines, 'net'), vat: sum(lines, 'vat'), gross: sum(lines, 'gross'), currency: 'EUR' as const };
    if (totals.gross > input.mandate.autoApproveLimit) {
      reasons.push({ code: 'OVER_AUTO_LIMIT', message: `Total €${totals.gross} is above the auto-approve limit €${input.mandate.autoApproveLimit}` });
    }

    const reasonCodes = [...new Set(reasons.map((reason) => reason.code))];
    const status = decisionStatusFor(reasonCodes);
    const order: Order = {
      orderId: `ord_mock_${this.orders.size + 1}`,
      agentId: input.agentId,
      mandateId: input.mandate.mandateId,
      customerRef: input.mandate.customerRef,
      buyerName: input.mandate.buyer.name,
      status: status === 'needs_approval' ? 'pending_approval' : status,
      lines,
      totals,
      neededBy: input.neededBy,
      requestText: input.requestText,
      rationale: input.rationale,
      decision: {
        status,
        reasonCodes,
        reasons: reasons.map((reason) => ({ ...reason, severity: REASON_CODE_INFO[reason.code].severity })),
        decidedAt: now.toISOString(),
        policyVersion: 'mock-0.1',
      },
      approval: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.orders.set(order.orderId, order);
    return { order };
  }

  approve_order(input: ToolInput<'approve_order'>): Promise<ToolOutput<'approve_order'>> {
    return this.resolve(input, 'approved');
  }

  reject_order(input: ToolInput<'reject_order'>): Promise<ToolOutput<'reject_order'>> {
    return this.resolve(input, 'rejected');
  }

  async get_order(input: ToolInput<'get_order'>): Promise<ToolOutput<'get_order'>> {
    const order = this.orders.get(input.orderId);
    if (!order) throw new Error(`Unknown order ${input.orderId}`);
    return { order };
  }

  async explain(input: ToolInput<'explain'>): Promise<ToolOutput<'explain'>> {
    const { order } = await this.get_order(input);
    const lines = order.lines.map((line) => `${line.quantity} × ${line.productId}`).join(', ');
    return {
      orderId: order.orderId,
      status: order.status,
      headline: `Order ${order.orderId} (${lines}) is ${order.status}.`,
      reasons: order.decision.reasons.map((reason) => ({ ...reason, source: REASON_CODE_INFO[reason.code].source, title: REASON_CODE_INFO[reason.code].title })),
      nextSteps: [],
      timeline: [],
    };
  }

  private async resolve(input: ToolInput<'approve_order' | 'reject_order'>, outcome: 'approved' | 'rejected'): Promise<ToolOutput<'approve_order'>> {
    const { order } = await this.get_order(input);
    if (order.status !== 'pending_approval') throw new Error(`Order ${order.orderId} is ${order.status}, not pending approval`);
    const at = this.now().toISOString();
    const resolved: Order = { ...order, status: outcome, approval: { outcome, by: input.approver, at, comment: input.comment }, updatedAt: at };
    this.orders.set(order.orderId, resolved);
    return { order: resolved };
  }
}
