// Synthetic demo data for the three demo scenes. Nothing here comes from the Aimo dataset.
import type { AuditEvent, Offer, Order, SignedOffer } from './contract';

function signed(offer: Partial<Offer> & Pick<Offer, 'offerId' | 'productId' | 'productName' | 'unit' | 'unitPrice'>): SignedOffer {
  return {
    offer: {
      quantity: 1,
      vatRate: 0.135,
      availableQuantity: 500,
      quantityVerified: true,
      availableDate: '2026-11-16',
      cutoffTime: '2026-11-15T12:00:00Z',
      salesBlock: false,
      origin: 'Finland',
      labels: [],
      validUntil: '2026-11-15T23:59:00Z',
      issuer: 'https://gateway.aimo.example',
      ...offer,
    },
    jws: 'mock.jws.not-a-real-signature',
  };
}

const milk = signed({
  offerId: 'off-2001',
  productId: 'p-milk-lf-12x1',
  productName: 'Lactose-free semi-skimmed milk 1 L',
  unit: 'case',
  unitPrice: 1380,
  labels: ['Lactose-free'],
});

const oats5 = signed({
  offerId: 'off-2002',
  productId: 'p-oat-gf-5kg',
  productName: 'Gluten-free oat flakes 5 kg',
  unit: 'bag',
  unitPrice: 2150,
  availableQuantity: 8,
  labels: ['Gluten-free'],
});

const oats1 = signed({
  offerId: 'off-2003',
  productId: 'p-oat-gf-1kg',
  productName: 'Gluten-free oat flakes 1 kg',
  unit: 'bag',
  unitPrice: 490,
  availableQuantity: 999999,
  quantityVerified: false,
  labels: ['Gluten-free'],
});

export const hotelOrder: Order = {
  orderId: 'ord-1001',
  agentId: 'agent:hotel-procure',
  agentName: 'Hotel purchasing agent',
  buyer: 'Harbour Hotel (demo)',
  mandateId: 'mandate-hotel-01',
  requestText: '1,000 L lactose-free milk by Monday',
  createdAt: '2026-11-13T18:02:10Z',
  lines: [{ signedOffer: milk, quantity: 84, packLabel: '12 x 1 L' }],
  status: 'auto_approved',
  decision: {
    status: 'auto_approved',
    reasonCodes: [],
    explanation:
      'Exact match, lactose-free, in verified stock for Monday. 1,000 L rounds up to 84 cases (1,008 L). The total is inside the mandate budget and the auto-approve limit.',
  },
  alternatives: [],
  trace: [
    { ts: '2026-11-13T18:02:10Z', text: 'Read the request: 1,000 L, lactose-free milk, delivery by Mon 16 Nov.' },
    { ts: '2026-11-13T18:02:11Z', tool: 'search_products', text: 'Searched the catalogue for lactose-free milk. 6 candidates.' },
    { ts: '2026-11-13T18:02:12Z', tool: 'get_offers', text: 'Asked for live price and stock for 3 shortlisted products. Verified the signature on each offer.' },
    { ts: '2026-11-13T18:02:13Z', text: 'Pack math: 1,000 L / 12 L per case = 83.3, rounded up to 84 cases (1,008 L).' },
    { ts: '2026-11-13T18:02:14Z', tool: 'propose_order', text: 'Proposed the order under mandate-hotel-01. Gateway decision: auto-approved.' },
  ],
};

export const hospitalOrder: Order = {
  orderId: 'ord-1002',
  agentId: 'agent:hospital-kitchen',
  agentName: 'Hospital kitchen agent',
  buyer: 'City Hospital kitchen (demo)',
  mandateId: 'mandate-hospital-01',
  requestText: '60 kg gluten-free oat flakes for Monday, no nuts',
  createdAt: '2026-11-13T18:20:41Z',
  lines: [
    { signedOffer: oats5, quantity: 8, packLabel: '5 kg' },
    { signedOffer: oats1, quantity: 20, packLabel: '1 kg' },
  ],
  status: 'needs_approval',
  decision: {
    status: 'needs_approval',
    reasonCodes: ['PARTIAL_AVAILABILITY', 'UNVERIFIED_STOCK'],
    explanation:
      'Only 40 kg of the 5 kg bags is in verified stock. The agent filled the missing 20 kg with the same product in 1 kg bags, which ship from a terminal, so the quantity is not confirmed. Both products are gluten-free and declare no nuts.',
  },
  alternatives: [
    {
      tier: 'good',
      title: 'Take only the 40 kg in stock',
      total: 17200,
      why: 'Lowest cost and fully verified, but 20 kg short of the request.',
      chosen: false,
    },
    {
      tier: 'better',
      title: '40 kg oat flakes + 20 kg gluten-free buckwheat flakes',
      total: 28400,
      why: 'Full quantity from verified stock, but buckwheat is a different grain and costs more.',
      chosen: false,
    },
    {
      tier: 'best',
      title: '40 kg in 5 kg bags + 20 kg in 1 kg bags',
      total: 27000,
      why: 'Same product for the full 60 kg. The 1 kg bags come from a terminal, so their quantity is not verified.',
      chosen: true,
    },
  ],
  trace: [
    { ts: '2026-11-13T18:20:41Z', text: 'Read the request: 60 kg, gluten-free oat flakes, no nuts, delivery by Mon 16 Nov.' },
    { ts: '2026-11-13T18:20:42Z', tool: 'search_products', text: 'Searched for gluten-free oat flakes free from nuts. Products with unknown allergen data were left out.' },
    { ts: '2026-11-13T18:20:43Z', tool: 'get_offers', text: 'Live stock: 8 bags of 5 kg (40 kg) verified. The 1 kg bags ship from a terminal, quantity not verified.' },
    { ts: '2026-11-13T18:20:44Z', text: 'Ranked three ways to cover the missing 20 kg: good, better, best.' },
    { ts: '2026-11-13T18:20:45Z', tool: 'propose_order', text: 'Proposed the "best" option under mandate-hospital-01. Gateway decision: needs approval.' },
  ],
};

export const rogueOrder: Order = {
  orderId: 'ord-1003',
  agentId: 'agent:unverified-reseller',
  agentName: 'Unverified reseller agent',
  buyer: 'Not verified',
  mandateId: null,
  requestText: '(no request text, order sent directly to the gateway)',
  createdAt: '2026-11-13T18:31:05Z',
  lines: [{ signedOffer: signed({ ...milk.offer, unitPrice: 138 }), quantity: 84, packLabel: '12 x 1 L' }],
  status: 'blocked',
  decision: {
    status: 'blocked',
    reasonCodes: ['OFFER_SIGNATURE_INVALID'],
    explanation:
      'The order quotes 1,38 € per case, but the offer Aimo signed says 13,80 €. The signature does not match the changed price, so the gateway refused the order.',
  },
  alternatives: [],
  trace: [
    { ts: '2026-11-13T18:31:05Z', tool: 'propose_order', text: 'Sent an order that reuses offer off-2001 with a different unit price.' },
    { ts: '2026-11-13T18:31:05Z', text: 'Gateway checked the offer signature. It did not match. Decision: blocked.' },
  ],
};

export type SeedEvent = Omit<AuditEvent, 'seq' | 'hash' | 'prevHash'>;

/** The four audit events an order produces on its way to a decision. */
export function eventsForOrder(o: Order): SeedEvent[] {
  const ctx = { agentId: o.agentId, buyer: o.buyer, ...(o.mandateId ? { mandateId: o.mandateId } : {}) };
  const offerIds = o.lines.map((l) => l.signedOffer.offer.offerId);
  const decided = `Decision for ${o.orderId}: ${o.decision.status.replace('_', ' ')}`;
  const events: SeedEvent[] = [];
  if (o.mandateId) {
    events.push(
      { ts: o.createdAt, actor: o.agentId, kind: 'request_received', orderId: o.orderId, summary: `Request: ${o.requestText}`, details: ctx },
      { ts: o.createdAt, actor: 'aimo', kind: 'offers_issued', orderId: o.orderId, summary: `Signed ${offerIds.length} offer(s) for ${o.agentName}`, details: { ...ctx, offerIds } },
    );
  }
  events.push(
    { ts: o.createdAt, actor: o.agentId, kind: 'order_proposed', orderId: o.orderId, summary: `Order ${o.orderId} proposed`, details: { ...ctx, offerIds } },
    {
      ts: o.createdAt,
      actor: 'aimo',
      kind: 'decision',
      orderId: o.orderId,
      summary: o.decision.reasonCodes.length ? `${decided} (${o.decision.reasonCodes.join(', ')})` : decided,
      details: { ...ctx, status: o.decision.status, reasonCodes: o.decision.reasonCodes },
    },
  );
  return events;
}
