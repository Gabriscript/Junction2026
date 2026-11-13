// shortcut: provisional copy of the shared contract, replace with imports from packages/shared once it lands
import { z } from 'zod';

export const Unit = z.enum(['L', 'KG', 'PCS']);
export type Unit = z.infer<typeof Unit>;

// PLAN.md section 6, "Draft reason codes"
export const ReasonCode = z.enum([
  'OVER_BUDGET',
  'OVER_AUTO_LIMIT',
  'SUBSTITUTION_OUTSIDE_PREFS',
  'ALLERGEN_CONFLICT',
  'UNVERIFIED_STOCK',
  'PARTIAL_AVAILABILITY',
  'AFTER_CUTOFF',
  'DELIVERY_LATER_THAN_NEEDED',
  'SALES_BLOCK',
  'OFFER_EXPIRED',
  'OFFER_SIGNATURE_INVALID',
  'MANDATE_EXPIRED',
  'UNKNOWN_AGENT',
  'QUERY_BUDGET_EXCEEDED',
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

// Subset of the portal product. attributes = nutritional claims ("lactose-free"),
// allergens = lowercase names the product contains or may contain.
export const Product = z.object({
  id: z.string(),
  name: z.string(),
  salesUnit: z.string(),
  baseUnit: z.string(),
  units: z.array(z.object({ unitId: z.string(), sizeInBaseUnits: z.number().positive() })),
  allowedLotSize: z.number().positive().optional(),
  countryOfOrigin: z.string().optional(),
  attributes: z.array(z.string()),
  allergens: z.array(z.string()).optional(), // missing = unknown, which is not the same as none
});
export type Product = z.infer<typeof Product>;

export const StructuredNeed = z.object({
  quantity: z.number().positive(),
  unit: Unit,
  productQuery: z.string().min(1),
  attributes: z.array(z.string()),
  freeFromAllergens: z.array(z.string()),
  deliveryBy: z.iso.date().nullable(), // null = the request gave no date
});
export type StructuredNeed = z.infer<typeof StructuredNeed>;

// The claim Aimo signs. Field names follow the WIP shared contract (@junction/shared);
// fields the agent does not read yet are optional here.
export const Offer = z.object({
  offerId: z.string(),
  productId: z.string(),
  productName: z.string().optional(),
  customerRef: z.string().optional(),
  requestedDate: z.iso.date().optional(),
  quantity: z.number().optional(), // sales units
  unit: z.string().optional(),
  unitPrice: z.number().nonnegative(), // EUR per sales unit, excl VAT
  currency: z.string().optional(),
  vatRate: z.number().nonnegative(), // percent
  totals: z.unknown().optional(),
  comparisonPrice: z.object({ value: z.number(), unit: z.string() }).nullable().optional(),
  netPriceFound: z.boolean().optional(),
  availableQuantity: z.number().nonnegative(), // sales units
  quantityVerified: z.boolean().optional(), // true = Stock, false = Terminal
  logisticModel: z.string().nullable().optional(),
  availableDate: z.iso.date().nullable(), // null = not deliverable on any date
  cutoffTime: z.iso.datetime({ offset: true }).nullable().optional(),
  salesBlock: z.boolean().optional(),
  origin: z.string().nullable(),
  labels: z.array(z.string()),
  validFrom: z.iso.datetime({ offset: true }).optional(),
  validUntil: z.iso.datetime({ offset: true }),
  issuer: z.string().optional(), // JWKS URL or did:web
  issuedAt: z.iso.datetime({ offset: true }).optional(),
});
export type Offer = z.infer<typeof Offer>;

// shortcut: assumes the compact JWS payload is the Offer JSON itself, adjust if the gateway wraps it (VC envelope)
export const SignedOffer = z.object({ offer: Offer, jws: z.string() });
export type SignedOffer = z.infer<typeof SignedOffer>;

export const Decision = z.object({
  status: z.enum(['auto_approved', 'needs_approval', 'blocked']),
  reasonCodes: z.array(ReasonCode),
});
export type Decision = z.infer<typeof Decision>;

// Tool inputs use the field names of the PLAN.md draft gateway tools.
export const SearchProductsInput = z.object({
  text: z.string().optional(),
  attributes: z.array(z.string()),
  free_from_allergens: z.array(z.string()),
  category: z.string().optional(),
  unit: Unit.optional(),
});
export type SearchProductsInput = z.infer<typeof SearchProductsInput>;

export const GetOffersInput = z.object({
  product_ids: z.array(z.string()),
  quantity: z.number().positive(),
  unit: Unit,
  delivery_date: z.iso.date().optional(),
});
export type GetOffersInput = z.infer<typeof GetOffersInput>;

export const OrderProposal = z.object({
  offer_ids: z.array(z.string()).min(1),
  quantities: z.array(z.number().positive()), // sales units, same order as offer_ids
  mandate: z.unknown().optional(), // Mandate schema is owned by the gateway side
});
export type OrderProposal = z.infer<typeof OrderProposal>;

export const Order = z.object({
  orderId: z.string(),
  offerIds: z.array(z.string()),
  quantities: z.array(z.number()),
  decision: Decision,
  status: z.enum(['placed', 'pending_approval', 'rejected', 'blocked']),
});
export type Order = z.infer<typeof Order>;

export const ApprovalInput = z.object({ order_id: z.string(), approver: z.string() });
export type ApprovalInput = z.infer<typeof ApprovalInput>;

export const Explanation = z.object({ orderId: z.string(), text: z.string() });
export type Explanation = z.infer<typeof Explanation>;
