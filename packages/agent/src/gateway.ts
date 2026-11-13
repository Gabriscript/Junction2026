import { CompactSign, exportJWK, generateKeyPair, type JSONWebKeySet } from 'jose';
import type {
  ApprovalInput,
  Decision,
  Explanation,
  GetOffersInput,
  Offer,
  Order,
  OrderProposal,
  Product,
  ReasonCode,
  SearchProductsInput,
  SignedOffer,
} from './contract.js';
import { addDays, todayIso } from './llm.js';

/** The 7 gateway tools (PLAN.md section 6). Verification keys are not part of it: they come from the agent's own trust config. */
export interface GatewayClient {
  searchProducts(input: SearchProductsInput): Promise<Product[]>;
  getOffers(input: GetOffersInput): Promise<SignedOffer[]>;
  proposeOrder(input: OrderProposal): Promise<Order>;
  approveOrder(input: ApprovalInput): Promise<Order>;
  rejectOrder(input: ApprovalInput): Promise<Order>;
  getOrder(input: { order_id: string }): Promise<Order>;
  explain(input: { order_id: string }): Promise<Explanation>;
}

interface FixtureProduct extends Product {
  price: number; // EUR per sales unit, ex VAT
  stock: number; // sales units
  leadDays: number;
  labels: string[];
  salesBlock?: boolean;
}

const milk = (
  id: string,
  name: string,
  salesUnit: string,
  packSize: number,
  price: number,
  stock: number,
  extra: Partial<FixtureProduct> = {},
): FixtureProduct => ({
  id,
  name,
  salesUnit,
  baseUnit: 'L',
  units: [{ unitId: salesUnit, sizeInBaseUnits: packSize }],
  allowedLotSize: 1,
  countryOfOrigin: 'fi',
  attributes: ['lactose-free'],
  allergens: ['milk'],
  price,
  stock,
  leadDays: 1,
  labels: [],
  ...extra,
});

// Synthetic, hand-written data. Not taken from the portal data set.
const FIXTURE: FixtureProduct[] = [
  milk('MILK-1L', 'Semi-skimmed milk 1 L', 'ST', 1, 0.95, 5000, { attributes: [] }),
  milk('LF-1L', 'Lactose-free semi-skimmed milk 1 L', 'ST', 1, 1.35, 5000),
  milk('LF-CASE12', 'Lactose-free semi-skimmed milk 12 x 1 L', 'KI', 12, 14.4, 500),
  milk('LF-BIB10', 'Lactose-free milk bag-in-box 10 L', 'ST', 10, 10.5, 40), // partial: 400 L in stock
  milk('LF-ORG-1L', 'Lactose-free organic milk 1 L', 'ST', 1, 1.6, 5000, {
    attributes: ['lactose-free', 'organic'],
    labels: ['EU_ORGANIC_FARMING'],
    leadDays: 7,
  }),
  milk('LF-BLOCKED', 'Lactose-free skimmed milk 1 L', 'ST', 1, 0.99, 5000, { salesBlock: true }),
];

const OFFER_TTL_MS = 15 * 60_000;
export const MOCK_ISSUER = 'mock-gateway';
const VAT_FOOD = 13.5;

export interface MockGatewayOptions {
  now?: () => Date;
  autoApproveLimit?: number; // EUR ex VAT, stands in for the buyer mandate
  offerTtlMs?: number;
  /** Per product id: stock override, null for unknown, 'unverified' for the Terminal placeholder. */
  stock?: Record<string, number | null | 'unverified'>;
}

/** In-memory stand-in for the Aimo gateway. Offers are really signed (ES256), so verification is real. */
export class MockGateway implements GatewayClient {
  private readonly now: () => Date;
  private readonly autoApproveLimit: number;
  private readonly offerTtlMs: number;
  private readonly stock: NonNullable<MockGatewayOptions['stock']>;
  private readonly keys = generateKeyPair('ES256');
  private readonly offers = new Map<string, Offer>();
  private readonly orders = new Map<string, Order>();

  constructor(options: MockGatewayOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.autoApproveLimit = options.autoApproveLimit ?? 5000;
    this.offerTtlMs = options.offerTtlMs ?? OFFER_TTL_MS;
    this.stock = options.stock ?? {};
  }

  /** The keys the mock "publishes". Read once at setup to build the agent's trust config, never during a run. */
  async getJwks(): Promise<JSONWebKeySet> {
    const jwk = await exportJWK((await this.keys).publicKey);
    return { keys: [{ ...jwk, kid: 'mock-1', alg: 'ES256', use: 'sig' }] };
  }

  async searchProducts(input: SearchProductsInput): Promise<Product[]> {
    const words = (input.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return FIXTURE.filter(
      (product) =>
        words.every((word) => product.name.toLowerCase().includes(word)) &&
        input.attributes.every((attribute) => product.attributes.includes(attribute)) &&
        !input.free_from_allergens.some((allergen) => product.allergens?.includes(allergen)),
    ).map(({ price, stock, leadDays, labels, salesBlock, ...product }) => product);
  }

  async getOffers(input: GetOffersInput): Promise<SignedOffer[]> {
    const { privateKey } = await this.keys;
    const now = this.now();
    const offers: SignedOffer[] = [];
    for (const product of FIXTURE.filter((candidate) => input.product_ids.includes(candidate.id))) {
      const packSize = product.units[0]?.sizeInBaseUnits;
      if (!packSize) continue; // a fixture without a sales unit cannot be quoted
      const availableDate = addDays(todayIso(now), product.leadDays);
      const stock = product.id in this.stock ? (this.stock[product.id] ?? null) : product.stock;
      const payload: Offer = {
        offerId: `offer-${this.offers.size + 1}`,
        productId: product.id,
        productName: product.name,
        customerRef: 'mock-customer',
        requestedDate: input.delivery_date ?? availableDate,
        quantity: Math.ceil(input.quantity / packSize),
        unit: product.salesUnit,
        unitPrice: product.price,
        currency: 'EUR',
        vatRate: VAT_FOOD,
        comparisonPrice: { value: Math.round((product.price / packSize) * 100) / 100, unit: product.baseUnit },
        netPriceFound: false,
        availableQuantity: stock === 'unverified' ? 999999 : stock,
        quantityVerified: stock !== 'unverified',
        logisticModel: stock === 'unverified' ? 'Terminal' : 'Stock',
        availableDate,
        cutoffTime: null,
        salesBlock: product.salesBlock ?? false,
        origin: product.countryOfOrigin ?? null,
        labels: product.labels,
        validFrom: now.toISOString(),
        validUntil: new Date(now.getTime() + this.offerTtlMs).toISOString(),
        issuer: MOCK_ISSUER,
        issuedAt: now.toISOString(),
      };
      const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
        .setProtectedHeader({ alg: 'ES256', kid: 'mock-1' })
        .sign(privateKey);
      this.offers.set(payload.offerId, payload);
      offers.push({ offer: payload, jws });
    }
    return offers;
  }

  async proposeOrder(input: OrderProposal): Promise<Order> {
    if (input.quantities.length !== input.offer_ids.length) throw new Error('quantities must match offer_ids');
    const reasons = new Set<ReasonCode>();
    let blocked = false;
    let total = 0;
    input.offer_ids.forEach((offerId, index) => {
      const offer = this.offers.get(offerId);
      if (!offer) throw new Error(`Unknown offer ${offerId}`);
      if (Date.parse(offer.validUntil) <= this.now().getTime()) {
        reasons.add('OFFER_EXPIRED');
        blocked = true;
      }
      const quantity = input.quantities[index] ?? 0; // lengths were checked above
      if (quantity > (offer.availableQuantity ?? 0)) reasons.add('PARTIAL_AVAILABILITY');
      total += offer.unitPrice * quantity;
    });
    if (total > this.autoApproveLimit) reasons.add('OVER_AUTO_LIMIT');

    const status: Decision['status'] = blocked ? 'blocked' : reasons.size ? 'needs_approval' : 'auto_approved';
    const order: Order = {
      orderId: `order-${this.orders.size + 1}`,
      offerIds: input.offer_ids,
      quantities: input.quantities,
      decision: { status, reasonCodes: [...reasons] },
      status: status === 'auto_approved' ? 'placed' : status === 'blocked' ? 'blocked' : 'pending_approval',
    };
    this.orders.set(order.orderId, order);
    return order;
  }

  approveOrder(input: ApprovalInput): Promise<Order> {
    return this.resolve(input.order_id, 'placed');
  }

  rejectOrder(input: ApprovalInput): Promise<Order> {
    return this.resolve(input.order_id, 'rejected');
  }

  async getOrder(input: { order_id: string }): Promise<Order> {
    const order = this.orders.get(input.order_id);
    if (!order) throw new Error(`Unknown order ${input.order_id}`);
    return order;
  }

  async explain(input: { order_id: string }): Promise<Explanation> {
    const order = await this.getOrder(input);
    const lines = order.offerIds.map((offerId, index) => `${order.quantities[index]} × ${this.offers.get(offerId)?.productId}`);
    const reasons = order.decision.reasonCodes.join(', ') || 'no reason codes';
    return { orderId: order.orderId, text: `Order ${order.orderId} (${lines.join(', ')}) is ${order.status}: ${order.decision.status}, ${reasons}.` };
  }

  private async resolve(orderId: string, status: 'placed' | 'rejected'): Promise<Order> {
    const order = await this.getOrder({ order_id: orderId });
    if (order.status !== 'pending_approval') throw new Error(`Order ${orderId} is ${order.status}, not pending approval`);
    const resolved = { ...order, status };
    this.orders.set(orderId, resolved);
    return resolved;
  }
}
