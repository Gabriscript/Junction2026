// Synthetic demo data for the three demo scenes: the scripted orders use 99xxxx ids, outside the real Aimo range,
// like the shared fixtures. Orders placed from the chat use real Aimo products (aimoProducts.ts).
import { totalsFromNet, type Actor, type AuditEvent, type AuditVisibility, type OrderLine, type Totals } from '@junction/shared';
import { AIMO_PRODUCTS } from './aimoProducts';
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

const milk = {
  offerId: 'off-2001',
  productId: '990101',
  productName: 'Lactose-free semi-skimmed milk 12 x 1 L',
  quantity: 84,
  unit: 'KI',
  unitPrice: 13.8,
};

const hotelLines = [line({ lineId: 'ln-1', ...milk })];
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
  requestText: '1,000 L lactose-free milk by Monday',
  rationale:
    'You asked for 1,000 L of lactose-free milk.\nOne crate holds 12 L, so 1,000 ÷ 12 = 83.3 crates. You cannot buy a third of a crate, so the agent rounds up to 84 crates: 84 × 12 L = 1,008 L.\nThe milk is in stock for Monday and the total is inside your budget, so it was ordered automatically.',
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
    { at: '2026-11-13T18:02:10Z', text: 'Read the request: 1,000 L, lactose-free milk, delivery by Mon 16 Nov.' },
    { at: '2026-11-13T18:02:11Z', tool: 'search_products', text: 'Searched the catalogue for lactose-free milk. 6 candidates.' },
    { at: '2026-11-13T18:02:12Z', tool: 'get_offers', text: 'Asked for live price and stock for 3 shortlisted products. Verified the signature on each offer.' },
    { at: '2026-11-13T18:02:13Z', text: 'Pack math: 1,000 L / 12 L per crate = 83.3, rounded up to 84 crates (1,008 L).' },
    { at: '2026-11-13T18:02:14Z', tool: 'propose_order', text: 'Proposed the order under mandate-hotel-01. Gateway decision: auto-approved.' },
  ],
};

// The agent's own substitution run (SUBSTITUTION_POLICY=same_category npx tsx packages/agent/src/cli.ts):
// the cheaper bag-in-box is short, so the agent fills the rest with crates. Numbers from that run, written in plain words.
const auroraLines = [
  line({ lineId: 'ln-1', offerId: 'off-2004', productId: '990105', productName: 'Lactose-free milk bag-in-box 10 L', quantity: 40, unit: 'PAK', unitPrice: 10.5 }),
  line({ lineId: 'ln-2', ...milk, offerId: 'off-2005', quantity: 50, unitPrice: 14.4, substituteFor: '990105' }),
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
  requestText: '1,000 L lactose-free milk by Monday',
  rationale:
    'You asked for 1,000 L. The cheapest milk per litre is the 10 L bag-in-box, so the agent takes as much of it as it can, then fills the rest.\nOnly 40 of the 100 bag-in-box packs are available: 40 × 10 L = 400 L. The missing 600 L come as 50 crates of 12 L (50 × 12 L = 600 L), the same lactose-free milk. Crates cost 14 % more per litre, but the mix is still cheaper than crates only: 1 140 € instead of 1 209,60 €.',
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
    { at: '2026-11-13T17:40:02Z', text: 'Read the request: 1,000 L, lactose-free milk, delivery by Mon 16 Nov.' },
    { at: '2026-11-13T17:40:03Z', tool: 'get_offers', text: 'Verified 5 signed offers. The bag-in-box is the cheapest per litre, but only 40 of 100 packs are available.' },
    { at: '2026-11-13T17:40:04Z', text: 'Filled the missing 600 L with the cheapest substitute the mandate allows (same category, lactose-free): 50 crates of 12 L.' },
    { at: '2026-11-13T17:40:05Z', text: 'Split order: 1 140,00 € instead of 1 209,60 € for crates only.' },
    { at: '2026-11-13T17:40:06Z', tool: 'propose_order', text: 'Proposed the order under mandate-aurora-01. Gateway decision: auto-approved.' },
  ],
};

const hospitalLines = [
  line({ lineId: 'ln-1', offerId: 'off-2002', productId: '990102', productName: 'Gluten-free oat flakes 5 kg', quantity: 8, unit: 'BAG', unitPrice: 21.5 }),
  line({ lineId: 'ln-2', offerId: 'off-2003', productId: '990103', productName: 'Gluten-free oat flakes 1 kg', quantity: 20, unit: 'BAG', unitPrice: 4.9 }),
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
  requestText: '60 kg gluten-free oat flakes for Monday, no nuts',
  rationale:
    'You asked for 60 kg of oat flakes, which is 12 bags of 5 kg.\nOnly 8 of those 12 bags are in stock: 8 × 5 kg = 40 kg. So 40 of the 60 kg are covered.\nThe missing 20 kg are filled with the same oat flakes in small bags: 20 bags × 1 kg = 20 kg.\nBoth bag sizes are gluten-free and contain no nuts.',
  decision: {
    status: 'needs_approval',
    reasonCodes: ['PARTIAL_AVAILABILITY', 'UNVERIFIED_STOCK'],
    reasons: [
      { code: 'PARTIAL_AVAILABILITY', severity: 'needs_approval', lineId: 'ln-1', message: 'You need 12 bags of 5 kg, but only 8 are available on Monday 16 Nov.' },
      { code: 'UNVERIFIED_STOCK', severity: 'needs_approval', lineId: 'ln-2', message: 'The 1 kg bags ship from a partner warehouse, so Valio Aimo cannot promise that all 20 are there. That is why you are asked to check.' },
    ],
    decidedAt: '2026-11-13T18:20:45Z',
    policyVersion: 'policy-0.1',
  },
  approval: null,
  createdAt: '2026-11-13T18:20:41Z',
  updatedAt: '2026-11-13T18:20:45Z',
  alternatives: [
    { tier: 'good', title: 'Take only the 40 kg in stock', total: 172, why: 'Lowest cost and fully verified, but 20 kg short of the request.', chosen: false },
    {
      tier: 'better',
      title: '40 kg oat flakes + 20 kg gluten-free buckwheat flakes',
      total: 284,
      why: 'Full quantity from verified stock, but buckwheat is a different grain and costs more.',
      chosen: false,
    },
    {
      tier: 'best',
      title: '40 kg in 5 kg bags + 20 kg in 1 kg bags',
      total: 270,
      why: 'Same product for the full 60 kg. The 1 kg bags come from a terminal, so their quantity is not verified.',
      chosen: true,
    },
  ],
  trace: [
    { at: '2026-11-13T18:20:41Z', text: 'Read the request: 60 kg, gluten-free oat flakes, no nuts, delivery by Mon 16 Nov.' },
    { at: '2026-11-13T18:20:42Z', tool: 'search_products', text: 'Searched for gluten-free oat flakes free from nuts. Products with unknown allergen data were left out.' },
    { at: '2026-11-13T18:20:43Z', tool: 'get_offers', text: 'Live stock: 8 bags of 5 kg (40 kg) verified. The 1 kg bags ship from a terminal, quantity not verified.' },
    { at: '2026-11-13T18:20:44Z', text: 'Ranked three ways to cover the missing 20 kg: good, better, best.' },
    { at: '2026-11-13T18:20:45Z', tool: 'propose_order', text: 'Proposed the "best" option under mandate-hospital-01. Gateway decision: needs approval.' },
  ],
};

// shortcut: shared Order requires a mandate and customer, so the unregistered agent replays an
// unknown mandate id; its audit events are Aimo-only.
const rogueLines = [line({ lineId: 'ln-1', ...milk, unitPrice: 1.38, offerVerified: false })];
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
          'Valio Aimo signed a price of 13,80 € per crate. This order says 1,38 €, ten times less. The signature no longer matches the price, so someone changed it. The gateway refused the order, and nobody can approve it.',
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
    { at: '2026-11-13T18:31:05Z', tool: 'propose_order', text: 'Sent an order that reuses offer off-2001 with a different unit price.' },
    { at: '2026-11-13T18:31:05Z', text: 'Gateway checked the offer signature. It did not match. Decision: blocked.' },
  ],
};

// EUR per unit, excl. VAT. milk is the real Aimo price API answer for 463335 (gateway fixture price.json, 2026-11-14);
// the rest are synthetic until the price API is queried for them. Unknown items get the fallback.
export const DEMO_UNIT_PRICES: Record<string, number> = {
  milk: 1.4, mozzarella: 9.8, tomatoes: 2.4, fries: 2.1, basil: 24, flour: 0.95, 'olive oil': 7.5, salt: 0.6, wurstel: 8.9,
};
export const FALLBACK_UNIT_PRICE = 5;

/** The order the mock "agent" places for a week the chef confirmed in the chat: one line per item, auto-approved. */
export function weekOrder(orderId: string, lines: { item: string; quantity: number; unit: string }[], requestText: string, at: string): UiOrder {
  const orderLines = lines.map((l, i) =>
    line({
      lineId: `ln-${i + 1}`,
      offerId: `off-${orderId}-${i + 1}`,
      productId: AIMO_PRODUCTS[l.item]?.productId ?? String(990300 + i),
      productName: AIMO_PRODUCTS[l.item]?.name ?? l.item.charAt(0).toUpperCase() + l.item.slice(1),
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: DEMO_UNIT_PRICES[l.item] ?? FALLBACK_UNIT_PRICE,
      availableDate: '2026-11-16',
    }),
  );
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
