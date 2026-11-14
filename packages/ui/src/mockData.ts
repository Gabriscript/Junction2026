// Demo data for the scripted scenes: real Aimo products (with photos) at real prices; the stories (stock, substitutes,
// a tampered price) are synthetic. Orders placed from the chat use the demo kitchen's products (aimoProducts.ts).
import { totalsFromNet, type Actor, type AuditEvent, type AuditVisibility, type OrderLine, type Totals } from '@junction/shared';
import { AIMO_PRODUCTS, toPacks } from './aimoProducts';
import type { UiOrder } from './contract';

export const gatewayActor: Actor = { type: 'gateway', id: 'gateway', name: 'Aimo gateway' };

function line(l: Omit<OrderLine, 'vatRate' | 'totals' | 'availableDate' | 'substituteFor' | 'offerVerified'> & Partial<OrderLine>): OrderLine {
  const vatRate = l.vatRate ?? 13.5;
  return {
    vatRate,
    totals: totalsFromNet(l.quantity * l.unitPrice, vatRate),
    availableDate: '2026-11-16',
    substituteFor: null,
    offerVerified: true,
    ...l,
  };
}

/** Sum of line totals, added in integer cents. */
function sumTotals(lines: readonly OrderLine[]): Totals {
  const sum = (k: 'net' | 'vat' | 'gross') => lines.reduce((s, l) => s + Math.round(l.totals[k] * 100), 0) / 100;
  return { net: sum('net'), vat: sum('vat'), gross: sum('gross'), currency: 'EUR' };
}

// Real Aimo products with a photo in public/products, priced with the real Aimo price API (customer 300, 16 Nov).
const tub5 = { productId: '465029', productName: 'GelatoLAB-Espoo 5L ice cream Vanilla lactose-free', unit: 'ST', unitPrice: 22.38 };
const tub25 = { productId: '473594', productName: 'GelatoLAB-Espoo 2,5L ice cream Vanilla Tahiti lactose-free', unit: 'ST', unitPrice: 13.42 };
const chocolate5 = { productId: '468062', productName: 'Pingviini Chocolate lactose free scoop ice cream 5L', unit: 'ST', unitPrice: 26.63 };

const hotelLines = [line({ lineId: 'ln-1', offerId: 'off-2001', ...tub5, quantity: 40 })];
export const hotelOrder: UiOrder = {
  orderId: 'ord-1001',
  agentId: 'agent:hotel-procure',
  agentName: 'Hotel purchasing agent',
  mandateId: 'mandate-hotel-01',
  customerRef: '100',
  buyerName: 'Harbour Hotel (demo)',
  status: 'auto_approved',
  lines: hotelLines,
  totals: sumTotals(hotelLines),
  neededBy: '2026-11-16',
  requestText: '200 L lactose-free vanilla ice cream by Monday',
  rationale:
    'You asked for 200 L of lactose-free vanilla ice cream.\nOne tub holds 5 L, so 200 ÷ 5 = 40 tubs, exactly 200 L.\nThe ice cream is in stock for Monday and the total is inside your budget, so it was ordered automatically.',
  decision: {
    status: 'auto_approved',
    reasonCodes: [],
    reasons: [],
    decidedAt: '2026-11-13T18:02:14Z',
    policyVersion: 'policy-0.1',
  },
  approval: null,
  createdAt: '2026-11-13T18:02:10Z',
  updatedAt: '2026-11-13T18:02:14Z',
  alternatives: [],
  trace: [
    { at: '2026-11-13T18:02:10Z', text: 'Read the request: 200 L, lactose-free vanilla ice cream, delivery by Mon 16 Nov.' },
    { at: '2026-11-13T18:02:11Z', tool: 'search_products', text: 'Searched the catalogue for lactose-free vanilla ice cream. 4 candidates.' },
    { at: '2026-11-13T18:02:12Z', tool: 'get_offers', text: 'Asked for live price and stock for 3 shortlisted products. Verified the signature on each offer.' },
    { at: '2026-11-13T18:02:13Z', text: 'Pack math: 200 L / 5 L per tub = 40 tubs (200 L).' },
    { at: '2026-11-13T18:02:14Z', tool: 'propose_order', text: 'Proposed the order under mandate-hotel-01. Gateway decision: auto-approved.' },
  ],
};

// The substitution story: the cheaper 5 L tub is short, so the agent fills the rest with 2.5 L tubs of the same ice cream.
const auroraLines = [
  line({ lineId: 'ln-1', offerId: 'off-2004', ...tub5, quantity: 40 }),
  line({ lineId: 'ln-2', offerId: 'off-2005', ...tub25, quantity: 40, substituteFor: '465029' }),
];
export const auroraOrder: UiOrder = {
  orderId: 'ord-1000',
  agentId: 'agent:aurora-kitchen',
  agentName: 'Hotel Aurora kitchen agent',
  mandateId: 'mandate-aurora-01',
  customerRef: '300',
  buyerName: 'Hotel Aurora kitchen (demo)',
  status: 'auto_approved',
  lines: auroraLines,
  totals: sumTotals(auroraLines),
  neededBy: '2026-11-16',
  requestText: '300 L lactose-free vanilla ice cream by Monday',
  rationale:
    'You asked for 300 L. The cheapest ice cream per litre is the 5 L tub, so the agent takes as much of it as it can, then fills the rest.\nOnly 40 of the 60 tubs of 5 L are available: 40 × 5 L = 200 L. The missing 100 L come as 40 tubs of 2,5 L (40 × 2,5 L = 100 L), the same lactose-free vanilla. Small tubs cost 20 % more per litre, but the mix is still cheaper than small tubs only: 1 432 € instead of 1 610,40 €.',
  decision: {
    status: 'auto_approved',
    reasonCodes: [],
    reasons: [],
    decidedAt: '2026-11-13T17:40:06Z',
    policyVersion: 'policy-0.1',
  },
  approval: null,
  createdAt: '2026-11-13T17:40:02Z',
  updatedAt: '2026-11-13T17:40:06Z',
  alternatives: [],
  trace: [
    { at: '2026-11-13T17:40:02Z', text: 'Read the request: 300 L, lactose-free vanilla ice cream, delivery by Mon 16 Nov.' },
    { at: '2026-11-13T17:40:03Z', tool: 'get_offers', text: 'Verified 4 signed offers. The 5 L tub is the cheapest per litre, but only 40 of 60 tubs are available.' },
    { at: '2026-11-13T17:40:04Z', text: 'Filled the missing 100 L with the cheapest substitute the mandate allows (same category, lactose-free): 40 tubs of 2,5 L.' },
    { at: '2026-11-13T17:40:05Z', text: 'Split order: 1 432,00 € instead of 1 610,40 € for small tubs only.' },
    { at: '2026-11-13T17:40:06Z', tool: 'propose_order', text: 'Proposed the order under mandate-aurora-01. Gateway decision: auto-approved.' },
  ],
};

const hospitalLines = [
  line({ lineId: 'ln-1', offerId: 'off-2002', ...tub5, quantity: 12 }),
  line({ lineId: 'ln-2', offerId: 'off-2003', ...tub25, quantity: 16 }),
];
export const hospitalOrder: UiOrder = {
  orderId: 'ord-1002',
  agentId: 'agent:hospital-kitchen',
  agentName: 'Hospital kitchen agent',
  mandateId: 'mandate-hospital-01',
  customerRef: '200',
  buyerName: 'City Hospital kitchen (demo)',
  status: 'pending_approval',
  lines: hospitalLines,
  totals: sumTotals(hospitalLines),
  neededBy: '2026-11-16',
  requestText: '100 L lactose-free vanilla ice cream for Monday, no nuts',
  rationale:
    'You asked for 100 L of ice cream, which is 20 tubs of 5 L.\nOnly 12 of those 20 tubs are in stock: 12 × 5 L = 60 L. So 60 of the 100 L are covered.\nThe missing 40 L are filled with the same lactose-free vanilla in small tubs: 16 tubs × 2,5 L = 40 L.\nBoth tub sizes are lactose-free and contain no nuts.',
  decision: {
    status: 'needs_approval',
    reasonCodes: ['PARTIAL_AVAILABILITY', 'UNVERIFIED_STOCK'],
    reasons: [
      { code: 'PARTIAL_AVAILABILITY', severity: 'needs_approval', lineId: 'ln-1', message: 'You need 20 tubs of 5 L, but only 12 are available on Monday 16 Nov.' },
      { code: 'UNVERIFIED_STOCK', severity: 'needs_approval', lineId: 'ln-2', message: 'The 2,5 L tubs ship from a partner warehouse, so Valio Aimo cannot promise that all 16 are there. That is why you are asked to check.' },
    ],
    decidedAt: '2026-11-13T18:20:45Z',
    policyVersion: 'policy-0.1',
  },
  approval: null,
  createdAt: '2026-11-13T18:20:41Z',
  updatedAt: '2026-11-13T18:20:45Z',
  alternatives: [
    { tier: 'good', title: 'Take only the 60 L in stock', total: 268.56, why: 'Lowest cost and fully verified, but 40 L short of the request.', chosen: false },
    {
      tier: 'better',
      title: '60 L vanilla + 40 L lactose-free chocolate',
      total: 481.6,
      why: 'Full quantity from verified stock, but chocolate is a different flavour from the one asked for.',
      chosen: false,
    },
    {
      tier: 'best',
      title: '60 L in 5 L tubs + 40 L in 2,5 L tubs',
      total: 483.28,
      why: 'Same ice cream for the full 100 L. The 2,5 L tubs come from a terminal, so their quantity is not verified.',
      chosen: true,
    },
  ],
  trace: [
    { at: '2026-11-13T18:20:41Z', text: 'Read the request: 100 L, lactose-free vanilla ice cream, no nuts, delivery by Mon 16 Nov.' },
    { at: '2026-11-13T18:20:42Z', tool: 'search_products', text: 'Searched for lactose-free ice cream free from nuts. Products with unknown allergen data were left out.' },
    { at: '2026-11-13T18:20:43Z', tool: 'get_offers', text: 'Live stock: 12 tubs of 5 L (60 L) verified. The 2,5 L tubs ship from a terminal, quantity not verified.' },
    { at: '2026-11-13T18:20:44Z', text: 'Ranked three ways to cover the missing 40 L: good, better, best.' },
    { at: '2026-11-13T18:20:45Z', tool: 'propose_order', text: 'Proposed the "best" option under mandate-hospital-01. Gateway decision: needs approval.' },
  ],
};

// shortcut: shared Order requires a mandate and customer, so the unregistered agent replays an
// unknown mandate id; its audit events are Aimo-only.
const rogueLines = [line({ lineId: 'ln-1', offerId: 'off-2006', ...chocolate5, quantity: 40, unitPrice: 2.66, offerVerified: false })];
export const rogueOrder: UiOrder = {
  orderId: 'ord-1003',
  agentId: 'agent:unverified-reseller',
  agentName: 'Unverified reseller agent',
  mandateId: 'mandate-unknown',
  customerRef: 'unknown',
  buyerName: 'Not verified',
  status: 'blocked',
  lines: rogueLines,
  totals: sumTotals(rogueLines),
  neededBy: '2026-11-16',
  requestText: '(no request text, order sent directly to the gateway)',
  decision: {
    status: 'blocked',
    reasonCodes: ['OFFER_SIGNATURE_INVALID'],
    reasons: [
      {
        code: 'OFFER_SIGNATURE_INVALID',
        severity: 'blocked',
        lineId: 'ln-1',
        message:
          'Valio Aimo signed a price of 26,63 € per tub. This order says 2,66 €, ten times less. The signature no longer matches the price, so someone changed it. The gateway refused the order, and nobody can approve it.',
      },
    ],
    decidedAt: '2026-11-13T18:31:05Z',
    policyVersion: 'policy-0.1',
  },
  approval: null,
  createdAt: '2026-11-13T18:31:05Z',
  updatedAt: '2026-11-13T18:31:05Z',
  alternatives: [],
  trace: [
    { at: '2026-11-13T18:31:05Z', tool: 'propose_order', text: 'Sent an order that reuses offer off-2006 with a different unit price.' },
    { at: '2026-11-13T18:31:05Z', text: 'Gateway checked the offer signature. It did not match. Decision: blocked.' },
  ],
};

// EUR per kitchen unit (L, KG), excl. VAT, for the synthetic history charts: the real Aimo price per pack
// (aimoProducts.ts) divided by the pack size. Unknown items get the fallback.
export const DEMO_UNIT_PRICES: Record<string, number> = Object.fromEntries(Object.entries(AIMO_PRODUCTS).map(([item, p]) => [item, p.price / p.packSize]));
export const FALLBACK_UNIT_PRICE = 5;

/** The order the mock "agent" places for a week the chef confirmed in the chat: one line per item, auto-approved. */
export function weekOrder(orderId: string, lines: { item: string; quantity: number; unit: string }[], requestText: string, at: string): UiOrder {
  // known products go in as whole packs at the real Aimo price, like the real agent's cart
  const orderLines = lines.map((l, i) => {
    const cart = toPacks(l.item, l.quantity);
    return line({
      lineId: `ln-${i + 1}`,
      offerId: `off-${orderId}-${i + 1}`,
      productId: cart?.product.productId ?? String(990300 + i),
      productName: cart?.product.name ?? l.item.charAt(0).toUpperCase() + l.item.slice(1),
      quantity: cart?.packs ?? l.quantity,
      unit: cart?.product.salesUnit ?? l.unit,
      unitPrice: cart?.product.price ?? FALLBACK_UNIT_PRICE,
      availableDate: '2026-11-16',
    });
  });
  return {
    orderId,
    agentId: 'agent:aurora-kitchen',
    agentName: 'Hotel Aurora kitchen agent',
    mandateId: 'mandate-aurora-01',
    customerRef: '300',
    buyerName: 'Hotel Aurora kitchen (demo)',
    status: 'auto_approved',
    lines: orderLines,
    totals: sumTotals(orderLines),
    neededBy: '2026-11-16',
    requestText,
    rationale: 'Confirmed by the chef in the chat after the pre-send review. One verified offer per line.',
    decision: { status: 'auto_approved', reasonCodes: [], reasons: [], decidedAt: at, policyVersion: 'policy-0.1' },
    approval: null,
    createdAt: at,
    updatedAt: at,
    alternatives: [],
    trace: [
      { at, text: `Read the confirmed week: ${lines.length} lines.` },
      { at, tool: 'get_offers', text: 'Asked for live price and stock for each line. Verified the signature on each offer.' },
      { at, tool: 'propose_order', text: 'Proposed the order under mandate-aurora-01. Gateway decision: auto-approved.' },
    ],
  };
}

export type SeedEvent = Omit<AuditEvent, 'seq' | 'eventId' | 'hash' | 'prevHash'>;

/** The audit events an order produces on its way to a decision. */
export function eventsForOrder(o: UiOrder, visibility: AuditVisibility[] = ['buyer', 'aimo']): SeedEvent[] {
  const agent: Actor = { type: 'agent', id: o.agentId, ...(o.agentName ? { name: o.agentName } : {}) };
  const base = { orderId: o.orderId, agentId: o.agentId, customerRef: o.customerRef, visibility };
  const offerIds = o.lines.map((l) => l.offerId);
  const decided = `Decision for ${o.orderId}: ${o.decision.status.replace('_', ' ')}`;
  const events: SeedEvent[] = [];
  if (visibility.includes('buyer')) {
    events.push({
      ...base,
      at: o.createdAt,
      type: 'offers_issued',
      actor: gatewayActor,
      reasonCodes: [],
      summary: `Signed ${offerIds.length} offer(s) for ${o.agentName ?? o.agentId}`,
      data: { mandateId: o.mandateId, offerIds },
    });
  }
  events.push(
    {
      ...base,
      at: o.createdAt,
      type: 'order_proposed',
      actor: agent,
      reasonCodes: [],
      summary: `Order ${o.orderId} proposed`,
      data: { mandateId: o.mandateId, offerIds },
    },
    {
      ...base,
      at: o.decision.decidedAt,
      type: 'order_decided',
      actor: gatewayActor,
      reasonCodes: o.decision.reasonCodes,
      summary: o.decision.reasonCodes.length ? `${decided} (${o.decision.reasonCodes.join(', ')})` : decided,
      data: { mandateId: o.mandateId, status: o.decision.status },
    },
  );
  return events;
}
