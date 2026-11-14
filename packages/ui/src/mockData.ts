// Synthetic demo data for the three demo scenes. Nothing here comes from the Aimo dataset
// (product ids are 99xxxx, outside the real Aimo range, like the shared fixtures).
import { totalsFromNet, type Actor, type AuditEvent, type AuditVisibility, type OrderLine, type Totals } from '@junction/shared';
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
    'Exact match, lactose-free, in verified stock for Monday. 1,000 L rounds up to 84 crates (1,008 L). The total is inside the mandate budget and the auto-approve limit.',
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
    'Only 40 kg of the 5 kg bags is in verified stock. The agent filled the missing 20 kg with the same product in 1 kg bags. Both products are gluten-free and declare no nuts.',
  decision: {
    status: 'needs_approval',
    reasonCodes: ['PARTIAL_AVAILABILITY', 'UNVERIFIED_STOCK'],
    reasons: [
      { code: 'PARTIAL_AVAILABILITY', severity: 'needs_approval', lineId: 'ln-1', message: 'Only 8 of 12 BAG of 5 kg available on 2026-11-16.' },
      { code: 'UNVERIFIED_STOCK', severity: 'needs_approval', lineId: 'ln-2', message: 'The 1 kg bags ship from a terminal; Valio Aimo cannot confirm 20 BAG.' },
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
          'The order quotes 1,38 € per crate, but the offer Aimo signed says 13,80 €. The signature does not match the changed price, so the gateway refused the order.',
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
