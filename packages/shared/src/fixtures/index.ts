/**
 * Contract fixtures — synthetic, schema-valid examples of every payload.
 *
 * Used by tests on both sides and by the mock gateway (agent + UI develop against it
 * until the real gateway is live). Import via `@junction/shared/fixtures`.
 *
 * - Product ids are `99xxxx`: deliberately OUTSIDE the real Aimo range (460000–477545).
 *   No data from the portal dataset is copied here (the dataset must not leave the challenge).
 * - `FIXTURE_JWS` is well-formed compact JWS but NOT a valid signature: verification
 *   against the gateway JWKS must fail (useful for the OFFER_SIGNATURE_INVALID path).
 * - Audit hashes ARE real sha256 values of `auditHashInput(event)` (checked by a test),
 *   so chain verification code can be tested against them.
 * - Scenario mirrors the demo: Hotel Aurora orders lactose-free milk; Helsinki General
 *   Hospital orders allergen-safe bread and muesli.
 */
import { totalsFromNet, type Actor } from '../common.js';
import type { AuditEvent } from '../audit.js';
import type { Mandate } from '../mandate.js';
import type { Offer, SignedOffer } from '../offer.js';
import type { Decision, Order, OrderLine, OrderProposal } from '../order.js';
import type { Product } from '../product.js';
import type {
  Explanation,
  GetOffersInput,
  GetOffersOutput,
  SearchProductsInput,
  SearchProductsOutput,
} from '../tools.js';

/** Well-formed compact JWS with an invalid signature (header `{"alg":"ES256","kid":"fixture"}`). */
export const FIXTURE_JWS =
  'eyJhbGciOiJFUzI1NiIsImtpZCI6ImZpeHR1cmUifQ.eyJmaXh0dXJlIjp0cnVlfQ.Zml4dHVyZS1ub3QtYS1yZWFsLXNpZ25hdHVyZQ';

export const FIXTURE_ISSUER = 'http://localhost:8787/.well-known/jwks.json';
export const NOW = '2026-11-14T09:00:00+02:00';

// ------------------------------------------------------------------ actors

export const gatewayActor: Actor = { type: 'gateway', id: 'gateway' };
export const hotelAgent: Actor = { type: 'agent', id: 'agent:hotel-buyer-1', name: 'Hotel Aurora buyer agent' };
export const hospitalAgent: Actor = { type: 'agent', id: 'agent:hospital-buyer-1', name: 'Hospital buyer agent' };
export const hotelManager: Actor = { type: 'human', id: 'user:hotel.manager', name: 'Mia (F&B manager)' };
export const hospitalChef: Actor = { type: 'human', id: 'user:hospital.chef', name: 'Antti (head chef)' };

// ------------------------------------------------------------------ products

export const milkLactoseFree: Product = {
  id: '990001',
  name: 'Lactose-free milk drink 1.5 % 1 L',
  nameFi: 'Laktoositon maitojuoma 1,5 % 1 L',
  brand: 'Fixture Dairy',
  supplier: 'Fixture Dairy Oy',
  category: '90001',
  originCountry: 'FI',
  labels: ['GOODS_FROM_FINLAND_BLUE_SWAN'],
  attributes: ['LACTOSE_FREE'],
  allergens: [{ code: 'AM', name: 'milk', level: 'CONTAINS' }],
  pack: {
    salesUnit: 'KI',
    baseUnit: 'ST',
    baseUnitsPerSalesUnit: 12,
    netContent: { amount: 12, unit: 'L' },
    comparisonUnit: 'L',
    allowedLotSize: 1,
  },
  substitutes: ['990002'],
  deliveryReliability: 0.98,
  carbonKgCo2ePerKg: 1.44,
  temperatureCondition: 8,
  gtin: '6400000000017',
};

export const milkLactoseFreeAlt: Product = {
  id: '990002',
  name: 'Lactose-free milk 1 % 1.5 L',
  supplier: 'Fixture Farms Ab',
  category: '90001',
  originCountry: 'SE',
  labels: [],
  attributes: ['LACTOSE_FREE'],
  allergens: [{ code: 'AM', name: 'milk', level: 'CONTAINS' }],
  pack: {
    salesUnit: 'KI',
    baseUnit: 'ST',
    baseUnitsPerSalesUnit: 8,
    netContent: { amount: 12, unit: 'L' },
    comparisonUnit: 'L',
    allowedLotSize: 1,
  },
  substitutes: [],
  deliveryReliability: null,
  carbonKgCo2ePerKg: null,
  temperatureCondition: 8,
};

export const glutenFreeBread: Product = {
  id: '990003',
  name: 'Gluten-free oat bread 500 g',
  nameFi: 'Gluteeniton kauraleipä 500 g',
  brand: 'Fixture Bakery',
  supplier: 'Fixture Bakery Oy',
  category: '90002',
  originCountry: 'FI',
  labels: ['MADE_IN_FINLAND_FLAG_WITH_KEY'],
  attributes: ['GLUTEN_FREE', 'VEGAN'],
  allergens: [
    { code: 'UW', name: 'cereals containing gluten', level: 'FREE_FROM' },
    { code: 'AN', name: 'tree nuts', level: 'FREE_FROM' },
    { code: 'AM', name: 'milk', level: 'FREE_FROM' },
  ],
  pack: {
    salesUnit: 'PAK',
    baseUnit: 'ST',
    baseUnitsPerSalesUnit: 6,
    netContent: { amount: 3, unit: 'KG' },
    comparisonUnit: 'KG',
    allowedLotSize: 1,
  },
  substitutes: [],
  deliveryReliability: 0.91,
  carbonKgCo2ePerKg: 0.87,
  temperatureCondition: 7,
};

export const muesliMayContainNuts: Product = {
  id: '990004',
  name: 'Oat muesli 2 kg',
  supplier: 'Fixture Mills Oy',
  category: '90002',
  originCountry: 'FI',
  labels: ['EU_ORGANIC_FARMING'],
  attributes: ['VEGAN'],
  allergens: [
    { code: 'GO', name: 'oats', level: 'CONTAINS' },
    { code: 'AN', name: 'tree nuts', level: 'MAY_CONTAIN' },
  ],
  pack: {
    salesUnit: 'KI',
    baseUnit: 'ST',
    baseUnitsPerSalesUnit: 4,
    netContent: { amount: 8, unit: 'KG' },
    comparisonUnit: 'KG',
    allowedLotSize: 1,
  },
  substitutes: [],
  deliveryReliability: 1,
  carbonKgCo2ePerKg: 1.1,
  temperatureCondition: null,
};

/** Sparse product: no allergen data at all → unknown → unsafe for any forbidden allergen. */
export const soupUnknownAllergens: Product = {
  id: '990005',
  name: 'Vegetable soup base 5 L',
  supplier: 'Fixture Foods Oy',
  category: '90003',
  originCountry: null,
  labels: [],
  attributes: [],
  allergens: [],
  pack: {
    salesUnit: 'ST',
    baseUnit: 'ST',
    baseUnitsPerSalesUnit: 1,
    netContent: null,
    comparisonUnit: null,
    allowedLotSize: 1,
  },
  substitutes: [],
  deliveryReliability: null,
  carbonKgCo2ePerKg: null,
};

export const products: readonly Product[] = [
  milkLactoseFree,
  milkLactoseFreeAlt,
  glutenFreeBread,
  muesliMayContainNuts,
  soupUnknownAllergens,
];

// ------------------------------------------------------------------ offers

const offerBase = {
  customerRef: '123',
  requestedDate: '2026-11-16',
  currency: 'EUR',
  validFrom: NOW,
  validUntil: '2026-11-14T09:30:00+02:00',
  issuer: FIXTURE_ISSUER,
  issuedAt: NOW,
} as const;

function offer(
  p: Product,
  o: Pick<Offer, 'offerId' | 'quantity' | 'unitPrice' | 'availableQuantity' | 'logisticModel' | 'availableDate' | 'cutoffTime'> &
    Partial<Pick<Offer, 'vatRate' | 'salesBlock' | 'netPriceFound' | 'comparisonPrice'>>,
): Offer {
  const vatRate = o.vatRate ?? 13.5;
  return {
    ...offerBase,
    productId: p.id,
    productName: p.name,
    unit: p.pack.salesUnit,
    vatRate,
    totals: totalsFromNet(o.quantity * o.unitPrice, vatRate),
    comparisonPrice: o.comparisonPrice ?? null,
    netPriceFound: o.netPriceFound ?? false,
    quantityVerified: o.logisticModel === 'Stock',
    salesBlock: o.salesBlock ?? false,
    origin: p.originCountry,
    labels: p.labels,
    ...o,
  };
}

/** 84 crates (= 1,008 L, the "1,000 L by Monday" case after pack rounding), Stock → verified. */
export const milkOffer: Offer = offer(milkLactoseFree, {
  offerId: 'off_fx_milk_1',
  quantity: 84,
  unitPrice: 14.4,
  comparisonPrice: { value: 1.2, unit: 'L' },
  availableQuantity: 120,
  logisticModel: 'Stock',
  availableDate: '2026-11-16',
  cutoffTime: '2026-11-15T17:00:00+02:00',
});

/** Terminal logistics → placeholder quantity, unverified → UNVERIFIED_STOCK. */
export const milkAltOffer: Offer = offer(milkLactoseFreeAlt, {
  offerId: 'off_fx_milk_2',
  quantity: 84,
  unitPrice: 13.2,
  comparisonPrice: { value: 1.1, unit: 'L' },
  availableQuantity: 999999,
  logisticModel: 'Terminal',
  availableDate: '2026-11-16',
  cutoffTime: '2026-11-15T12:00:00+02:00',
});

export const breadOffer: Offer = offer(glutenFreeBread, {
  offerId: 'off_fx_bread_1',
  quantity: 40,
  unitPrice: 18.9,
  availableQuantity: 25,
  logisticModel: 'Stock',
  availableDate: '2026-11-16',
  cutoffTime: '2026-11-15T17:00:00+02:00',
});

export const muesliOffer: Offer = offer(muesliMayContainNuts, {
  offerId: 'off_fx_muesli_1',
  quantity: 10,
  unitPrice: 31.5,
  availableQuantity: 200,
  logisticModel: 'Stock',
  availableDate: '2026-11-17',
  cutoffTime: '2026-11-15T17:00:00+02:00',
});

const sign = (o: Offer): SignedOffer => ({ offer: o, jws: FIXTURE_JWS });
export const signedMilkOffer = sign(milkOffer);
export const signedMilkAltOffer = sign(milkAltOffer);
export const signedBreadOffer = sign(breadOffer);
export const signedMuesliOffer = sign(muesliOffer);

// ------------------------------------------------------------------ mandates

export const hotelMandate: Mandate = {
  mandateId: 'mdt_fx_hotel_1',
  customerRef: '123',
  buyer: { orgId: 'org:hotel-aurora', name: 'Hotel Aurora' },
  agentId: hotelAgent.id,
  issuedBy: hotelManager,
  issuedAt: '2026-11-01T08:00:00+02:00',
  validFrom: '2026-11-01T08:00:00+02:00',
  validUntil: '2026-11-30T23:59:59+02:00',
  budgetLimit: 5000,
  autoApproveLimit: 1500,
  forbiddenAllergens: [],
  requiredAttributes: ['LACTOSE_FREE'],
  substitutionPolicy: 'aimo_listed',
  allowedCategories: null,
};

export const hospitalMandate: Mandate = {
  mandateId: 'mdt_fx_hospital_1',
  customerRef: '456',
  buyer: { orgId: 'org:helsinki-general', name: 'Helsinki General Hospital kitchen' },
  agentId: hospitalAgent.id,
  issuedBy: hospitalChef,
  issuedAt: '2026-11-01T08:00:00+02:00',
  validFrom: '2026-11-01T08:00:00+02:00',
  validUntil: '2026-11-30T23:59:59+02:00',
  budgetLimit: 3000,
  autoApproveLimit: 500,
  forbiddenAllergens: ['AN', 'UW'],
  requiredAttributes: [],
  substitutionPolicy: 'same_category',
  allowedCategories: null,
};

/** Same as `hotelMandate` but expired → MANDATE_EXPIRED (attack scene). */
export const expiredMandate: Mandate = {
  ...hotelMandate,
  mandateId: 'mdt_fx_hotel_expired',
  validUntil: '2026-11-10T23:59:59+02:00',
};

// ------------------------------------------------------------------ tool inputs / outputs

export const searchMilkInput: SearchProductsInput = {
  text: 'lactose free milk',
  attributes: ['LACTOSE_FREE'],
  unit: 'L',
  limit: 10,
};

export const searchMilkOutput: SearchProductsOutput = {
  products: [milkLactoseFree, milkLactoseFreeAlt],
  truncated: false,
};

export const getMilkOffersInput: GetOffersInput = {
  agentId: hotelAgent.id,
  customerRef: '123',
  items: [
    { productId: '990001', quantity: 84 },
    { productId: '990002', quantity: 84 },
  ],
  requestedDate: '2026-11-16',
};

export const getMilkOffersOutput: GetOffersOutput = {
  offers: [signedMilkOffer, signedMilkAltOffer],
  unavailable: [],
  jwksUrl: FIXTURE_ISSUER,
};

export const hotelProposal: OrderProposal = {
  agentId: hotelAgent.id,
  mandate: hotelMandate,
  lines: [{ offerId: milkOffer.offerId, offerJws: FIXTURE_JWS, quantity: 84, substituteFor: null }],
  neededBy: '2026-11-16',
  requestText: '1,000 L lactose-free milk by Monday',
  rationale: '84 crates × 12 L = 1,008 L (rounded up to whole crates). Cheapest verified-stock option.',
};

export const hospitalProposal: OrderProposal = {
  agentId: hospitalAgent.id,
  mandate: hospitalMandate,
  lines: [
    { offerId: breadOffer.offerId, offerJws: FIXTURE_JWS, quantity: 40, substituteFor: null },
    { offerId: muesliOffer.offerId, offerJws: FIXTURE_JWS, quantity: 10, substituteFor: null },
  ],
  neededBy: '2026-11-16',
  requestText: 'Gluten- and nut-free breakfast for ward 4, 40 packs of bread and muesli',
};

// ------------------------------------------------------------------ orders

function lineFrom(o: Offer, lineId: string, substituteFor: string | null = null): OrderLine {
  return {
    lineId,
    offerId: o.offerId,
    productId: o.productId,
    productName: o.productName,
    quantity: o.quantity,
    unit: o.unit,
    unitPrice: o.unitPrice,
    vatRate: o.vatRate,
    totals: o.totals,
    availableDate: o.availableDate,
    substituteFor,
    offerVerified: true,
  };
}

function sumTotals(lines: readonly OrderLine[]): Order['totals'] {
  // All fixture lines share one VAT rate per order, so totalsFromNet on the net sum is exact.
  const net = lines.reduce((s, l) => s + l.totals.net, 0);
  return totalsFromNet(net, lines[0]!.vatRate);
}

const autoDecision: Decision = {
  status: 'auto_approved',
  reasonCodes: [],
  reasons: [],
  decidedAt: '2026-11-14T09:01:00+02:00',
  policyVersion: 'policy-0.1',
};

const hotelLines = [lineFrom(milkOffer, 'ln_1')];
export const autoApprovedOrder: Order = {
  orderId: 'ord_fx_1',
  agentId: hotelAgent.id,
  mandateId: hotelMandate.mandateId,
  customerRef: hotelMandate.customerRef,
  buyerName: hotelMandate.buyer.name,
  status: 'auto_approved',
  lines: hotelLines,
  totals: sumTotals(hotelLines),
  neededBy: '2026-11-16',
  requestText: hotelProposal.requestText,
  rationale: hotelProposal.rationale,
  decision: autoDecision,
  approval: null,
  createdAt: '2026-11-14T09:01:00+02:00',
  updatedAt: '2026-11-14T09:01:00+02:00',
};

const altLines = [lineFrom(milkAltOffer, 'ln_1', '990001')];
export const pendingApprovalOrder: Order = {
  ...autoApprovedOrder,
  orderId: 'ord_fx_2',
  status: 'pending_approval',
  lines: altLines,
  totals: sumTotals(altLines),
  rationale: 'Preferred product short on stock; Aimo-listed substitute from supplier (Terminal).',
  decision: {
    status: 'needs_approval',
    reasonCodes: ['UNVERIFIED_STOCK'],
    reasons: [
      {
        code: 'UNVERIFIED_STOCK',
        severity: 'needs_approval',
        lineId: 'ln_1',
        message: 'Lactose-free milk 1 % 1.5 L ships from the supplier; Valio Aimo cannot confirm 84 KI.',
      },
    ],
    decidedAt: '2026-11-14T09:05:00+02:00',
    policyVersion: 'policy-0.1',
  },
  createdAt: '2026-11-14T09:05:00+02:00',
  updatedAt: '2026-11-14T09:05:00+02:00',
};

export const approvedOrder: Order = {
  ...pendingApprovalOrder,
  status: 'approved',
  approval: { outcome: 'approved', by: hotelManager, at: '2026-11-14T09:12:00+02:00', comment: 'OK, supplier is reliable.' },
  updatedAt: '2026-11-14T09:12:00+02:00',
};

const hospitalLines = [lineFrom(breadOffer, 'ln_1'), lineFrom(muesliOffer, 'ln_2')];
export const blockedOrder: Order = {
  orderId: 'ord_fx_3',
  agentId: hospitalAgent.id,
  mandateId: hospitalMandate.mandateId,
  customerRef: hospitalMandate.customerRef,
  buyerName: hospitalMandate.buyer.name,
  status: 'blocked',
  lines: hospitalLines,
  totals: sumTotals(hospitalLines),
  neededBy: '2026-11-16',
  requestText: hospitalProposal.requestText,
  decision: {
    status: 'blocked',
    reasonCodes: ['ALLERGEN_CONFLICT', 'PARTIAL_AVAILABILITY', 'OVER_AUTO_LIMIT', 'DELIVERY_LATER_THAN_NEEDED'],
    reasons: [
      {
        code: 'ALLERGEN_CONFLICT',
        severity: 'blocked',
        lineId: 'ln_2',
        message: 'Oat muesli 2 kg MAY_CONTAIN tree nuts (AN), forbidden by the mandate.',
      },
      {
        code: 'PARTIAL_AVAILABILITY',
        severity: 'needs_approval',
        lineId: 'ln_1',
        message: 'Only 25 of 40 PAK available on 2026-11-16.',
      },
      {
        code: 'OVER_AUTO_LIMIT',
        severity: 'needs_approval',
        message: 'Order total €1,215.59 is above the €500.00 auto-approve limit.',
      },
      {
        code: 'DELIVERY_LATER_THAN_NEEDED',
        severity: 'needs_approval',
        lineId: 'ln_2',
        message: 'Earliest delivery 2026-11-17, needed by 2026-11-16.',
      },
    ],
    decidedAt: '2026-11-14T09:20:00+02:00',
    policyVersion: 'policy-0.1',
  },
  approval: null,
  createdAt: '2026-11-14T09:20:00+02:00',
  updatedAt: '2026-11-14T09:20:00+02:00',
};

export const orders: readonly Order[] = [autoApprovedOrder, pendingApprovalOrder, approvedOrder, blockedOrder];

// ------------------------------------------------------------------ audit chain

/**
 * A 4-event chain for the hotel happy path. Hashes are real sha256 over
 * `auditHashInput(event)`. After editing any field here, `fixtures.test.ts` fails and
 * prints the expected `prevHash`/`hash` values to paste back.
 */
export const auditChain: readonly AuditEvent[] = [
  {
    seq: 0,
    eventId: 'evt_fx_0',
    at: '2026-11-14T09:00:00+02:00',
    type: 'offers_issued',
    actor: gatewayActor,
    orderId: null,
    agentId: hotelAgent.id,
    customerRef: '123',
    reasonCodes: [],
    summary: 'Issued 2 signed offers to agent:hotel-buyer-1',
    data: { offerIds: ['off_fx_milk_1', 'off_fx_milk_2'] },
    visibility: ['buyer', 'aimo'],
    prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
    hash: '13e6af8c74665fece4d625d305aef2f3c4200c9f1dc6c72e5301dce12090a8ea',
  },
  {
    seq: 1,
    eventId: 'evt_fx_1',
    at: '2026-11-14T09:01:00+02:00',
    type: 'order_proposed',
    actor: hotelAgent,
    orderId: 'ord_fx_1',
    agentId: hotelAgent.id,
    customerRef: '123',
    reasonCodes: [],
    summary: 'agent:hotel-buyer-1 proposed ord_fx_1 (1 line)',
    data: { offerIds: ['off_fx_milk_1'] },
    visibility: ['buyer', 'aimo'],
    prevHash: '13e6af8c74665fece4d625d305aef2f3c4200c9f1dc6c72e5301dce12090a8ea',
    hash: 'd9e74c974dbaaffbc5462272760f466a657657f3dd43d8e341fa9d8f1f698412',
  },
  {
    seq: 2,
    eventId: 'evt_fx_2',
    at: '2026-11-14T09:01:00+02:00',
    type: 'order_decided',
    actor: gatewayActor,
    orderId: 'ord_fx_1',
    agentId: hotelAgent.id,
    customerRef: '123',
    reasonCodes: [],
    summary: 'ord_fx_1 auto-approved',
    data: { status: 'auto_approved' },
    visibility: ['buyer', 'aimo'],
    prevHash: 'd9e74c974dbaaffbc5462272760f466a657657f3dd43d8e341fa9d8f1f698412',
    hash: '672f3408eeb73aa189066063ebe76121d52f7e2b2551e167f6e4aea987bd950e',
  },
  {
    seq: 3,
    eventId: 'evt_fx_3',
    at: '2026-11-14T09:02:00+02:00',
    type: 'offer_rejected',
    actor: gatewayActor,
    orderId: null,
    agentId: 'agent:rogue-1',
    customerRef: null,
    reasonCodes: ['OFFER_SIGNATURE_INVALID', 'UNKNOWN_AGENT'],
    summary: 'Rejected proposal from unknown agent:rogue-1 with a tampered offer',
    data: { offerId: 'off_fx_milk_1' },
    visibility: ['aimo'],
    prevHash: '672f3408eeb73aa189066063ebe76121d52f7e2b2551e167f6e4aea987bd950e',
    hash: '9bc0398b878c1502d3c957113de74bfb9bd282e7f051e23397db9ab20b9cb4e4',
  },
];

export const pendingExplanation: Explanation = {
  orderId: pendingApprovalOrder.orderId,
  status: 'pending_approval',
  headline: 'Needs approval: the substitute ships from the supplier, so Valio Aimo cannot confirm the stock.',
  reasons: [
    {
      code: 'UNVERIFIED_STOCK',
      severity: 'needs_approval',
      source: 'aimo',
      title: 'Stock not verified',
      message: 'Lactose-free milk 1 % 1.5 L ships from the supplier; Valio Aimo cannot confirm 84 KI.',
      lineId: 'ln_1',
    },
  ],
  nextSteps: ['Approve or reject in the approval app', 'Or ask the agent for a verified-stock alternative'],
  timeline: [],
};
