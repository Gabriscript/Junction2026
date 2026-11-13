import type { ReasonCode } from './contract';

export interface ReasonInfo {
  title: string;
  explanation: string;
  severity: 'needs_approval' | 'blocked';
}

export const REASONS: Record<ReasonCode, ReasonInfo> = {
  OVER_BUDGET: {
    title: 'Over budget',
    explanation: 'The order total is higher than the budget left in the mandate.',
    severity: 'needs_approval',
  },
  OVER_AUTO_LIMIT: {
    title: 'Above auto-approve limit',
    explanation: 'The order total is higher than what the agent may approve on its own.',
    severity: 'needs_approval',
  },
  SUBSTITUTION_OUTSIDE_PREFS: {
    title: 'Substitute outside preferences',
    explanation: 'The agent picked a replacement product the mandate does not list as allowed.',
    severity: 'needs_approval',
  },
  ALLERGEN_CONFLICT: {
    title: 'Allergen conflict',
    explanation: 'A product contains, or may contain, an allergen the mandate forbids. This can never be approved.',
    severity: 'blocked',
  },
  UNVERIFIED_STOCK: {
    title: 'Stock not verified',
    explanation: 'The product ships from a terminal, so Aimo cannot confirm the quantity before the order.',
    severity: 'needs_approval',
  },
  PARTIAL_AVAILABILITY: {
    title: 'Partly available',
    explanation: 'The requested product covers only part of the quantity. The rest is split or substituted.',
    severity: 'needs_approval',
  },
  AFTER_CUTOFF: {
    title: 'After order cut-off',
    explanation: 'The order was placed after the cut-off time for the requested delivery.',
    severity: 'needs_approval',
  },
  DELIVERY_LATER_THAN_NEEDED: {
    title: 'Delivery later than needed',
    explanation: 'The earliest available date is after the date in the request.',
    severity: 'needs_approval',
  },
  SALES_BLOCK: {
    title: 'Sales block',
    explanation: 'Aimo has blocked this product from sale.',
    severity: 'blocked',
  },
  OFFER_EXPIRED: {
    title: 'Offer expired',
    explanation: 'The signed offer was no longer valid when the order arrived.',
    severity: 'blocked',
  },
  OFFER_SIGNATURE_INVALID: {
    title: 'Offer signature invalid',
    explanation: "The order does not match an offer signed by Aimo. The price or terms were changed.",
    severity: 'blocked',
  },
  MANDATE_EXPIRED: {
    title: 'Mandate expired',
    explanation: "The buyer's mandate for this agent is no longer valid.",
    severity: 'blocked',
  },
  UNKNOWN_AGENT: {
    title: 'Unknown agent',
    explanation: 'The agent is not registered with Aimo.',
    severity: 'blocked',
  },
  QUERY_BUDGET_EXCEEDED: {
    title: 'Query budget exceeded',
    explanation: 'The agent asked for more prices or stock levels than its allowance.',
    severity: 'needs_approval',
  },
};
