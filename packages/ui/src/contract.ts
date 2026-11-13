// shortcut: provisional copy of the shared contract, replace with imports from @junction/shared once it lands

export interface Offer {
  offerId: string;
  productId: string;
  productName: string;
  /** Quantity the offer covers, in `unit`. */
  quantity: number;
  unit: string;
  /** Integer euro cents per unit, excluding VAT. */
  unitPrice: number;
  /** Fraction, e.g. 0.135 for 13.5 %. */
  vatRate: number;
  availableQuantity: number;
  /** true = Stock (verified quantity), false = Terminal (unverified quantity). */
  quantityVerified: boolean;
  availableDate: string;
  cutoffTime: string;
  salesBlock: boolean;
  origin: string | null;
  labels: string[];
  validUntil: string;
  issuer: string;
}

export interface SignedOffer {
  offer: Offer;
  jws: string;
}

export type DecisionStatus = 'auto_approved' | 'needs_approval' | 'blocked';

export const REASON_CODES = [
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
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export interface Decision {
  status: DecisionStatus;
  reasonCodes: ReasonCode[];
  /** Human-readable "why" written by the gateway's explain tool. */
  explanation: string;
}

// ---- Below: modelled by the UI, not yet agreed in @junction/shared ----

/** The policy decision, plus the two outcomes of a human review. */
export type OrderStatus = DecisionStatus | 'approved' | 'rejected';

export interface OrderLine {
  signedOffer: SignedOffer;
  /** Number of packs ordered; one pack = one `offer.unit`. */
  quantity: number;
  /** What one pack contains, e.g. "12 x 1 L". */
  packLabel: string;
}

export interface Alternative {
  tier: 'good' | 'better' | 'best';
  title: string;
  /** Integer euro cents, excluding VAT. */
  total: number;
  why: string;
  /** true for the option the agent put in the cart. */
  chosen: boolean;
}

export interface TraceStep {
  ts: string;
  /** Gateway tool the agent called, if any. */
  tool?: string;
  text: string;
}

export interface Order {
  orderId: string;
  agentId: string;
  agentName: string;
  buyer: string;
  /** null when the agent presented no valid mandate. */
  mandateId: string | null;
  requestText: string;
  createdAt: string;
  lines: OrderLine[];
  status: OrderStatus;
  decision: Decision;
  alternatives: Alternative[];
  trace: TraceStep[];
  review?: { action: 'approved' | 'rejected'; approver: string; at: string; reason?: string };
}

export interface AuditEvent {
  seq: number;
  ts: string;
  /** Agent id, "human" or "aimo". */
  actor: string;
  kind: string;
  orderId?: string;
  summary: string;
  details: Record<string, unknown>;
  hash: string;
  prevHash: string;
}

export type AuditScope = 'buyer' | 'aimo';
