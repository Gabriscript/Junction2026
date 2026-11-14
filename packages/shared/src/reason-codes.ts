/**
 * Reason codes and decision statuses.
 *
 * The policy engine (gateway, `src/policy/`) evaluates an order proposal against
 * the buyer mandate and Aimo's own rules and emits zero or more reason codes.
 * The decision status is derived from the codes:
 *   - any code with severity `blocked`         → `blocked`
 *   - otherwise any `needs_approval` code      → `needs_approval`
 *   - no codes                                  → `auto_approved`
 *
 * Severities below are the CONTRACT DEFAULT. The policy engine may escalate
 * `needs_approval` → `blocked` for a specific case (e.g. OVER_BUDGET by 10×) but
 * must never downgrade a `blocked` code. UIs should display `REASON_CODE_INFO`
 * text next to each code so a human sees *why* a card is in their queue.
 */
import { z } from 'zod';

export const REASON_CODES = [
  // ---- buyer mandate ----
  'OVER_BUDGET',
  'OVER_AUTO_LIMIT',
  'SUBSTITUTION_OUTSIDE_PREFS',
  'ALLERGEN_CONFLICT',
  // ---- availability / logistics (Aimo rules) ----
  'UNVERIFIED_STOCK',
  'PARTIAL_AVAILABILITY',
  'AFTER_CUTOFF',
  'DELIVERY_LATER_THAN_NEEDED',
  'SALES_BLOCK',
  // ---- trust (signatures, validity, identity) ----
  'OFFER_EXPIRED',
  'OFFER_SIGNATURE_INVALID',
  'MANDATE_EXPIRED',
  'UNKNOWN_AGENT',
  'QUERY_BUDGET_EXCEEDED',
] as const;

export const ReasonCodeSchema = z.enum(REASON_CODES).describe('Policy reason code');
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

/** Outcome of the policy engine for one proposal. */
export const DecisionStatusSchema = z
  .enum(['auto_approved', 'needs_approval', 'blocked'])
  .describe('auto_approved | needs_approval | blocked');
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

/** Severity of a single reason code (a code can never be "auto_approved"). */
export const ReasonSeveritySchema = z.enum(['needs_approval', 'blocked']);
export type ReasonSeverity = z.infer<typeof ReasonSeveritySchema>;

export interface ReasonCodeInfo {
  /** Default severity. `blocked` codes can never be overridden by a human approver. */
  severity: ReasonSeverity;
  /** Short label for cards / badges (≤ 4 words). */
  title: string;
  /** One-sentence explanation shown to the approver. */
  description: string;
  /** Who owns the rule: the buyer's mandate or Valio Aimo's own rules. */
  source: 'mandate' | 'aimo';
}

/**
 * Default severity + copy for every reason code.
 *
 * Rationale for `blocked` (no human can approve these away):
 * - ALLERGEN_CONFLICT: a food-safety hard constraint; the whole point of the hospital persona.
 * - OFFER_SIGNATURE_INVALID / OFFER_EXPIRED: the price is no longer provable → a human cannot
 *   "approve" a fixed price that Aimo never committed to; the agent must fetch new offers.
 * - MANDATE_EXPIRED / UNKNOWN_AGENT: the agent has no valid authority at all → nothing to approve.
 * - QUERY_BUDGET_EXCEEDED: Aimo-side rate protection; an approval would not make the agent trusted again.
 * - SALES_BLOCK: Aimo itself refuses to sell the item right now; approving on the buyer side changes nothing.
 *
 * Rationale for `needs_approval` (a human can decide):
 * - OVER_BUDGET / OVER_AUTO_LIMIT: money decisions belong to the human who issued the mandate.
 * - SUBSTITUTION_OUTSIDE_PREFS: a different-than-asked product may still be fine (good-better-best).
 * - UNVERIFIED_STOCK (Terminal) / PARTIAL_AVAILABILITY / AFTER_CUTOFF / DELIVERY_LATER_THAN_NEEDED:
 *   operational trade-offs (wait, split, accept risk) that a kitchen manager can judge.
 */
export const REASON_CODE_INFO: Readonly<Record<ReasonCode, ReasonCodeInfo>> = {
  OVER_BUDGET: {
    severity: 'needs_approval',
    source: 'mandate',
    title: 'Over budget',
    description: 'The order would exceed the remaining budget of the buyer mandate.',
  },
  OVER_AUTO_LIMIT: {
    severity: 'needs_approval',
    source: 'mandate',
    title: 'Over auto-approve limit',
    description: 'The order total is above the amount the agent may approve on its own.',
  },
  SUBSTITUTION_OUTSIDE_PREFS: {
    severity: 'needs_approval',
    source: 'mandate',
    title: 'Substitute product',
    description: 'A line contains a substitute that is outside the substitution policy of the mandate.',
  },
  ALLERGEN_CONFLICT: {
    severity: 'blocked',
    source: 'mandate',
    title: 'Allergen conflict',
    description:
      'A product contains, may contain, or has unknown data for an allergen the mandate requires to be absent.',
  },
  UNVERIFIED_STOCK: {
    severity: 'needs_approval',
    source: 'aimo',
    title: 'Stock not verified',
    description:
      'The product ships from the supplier (Terminal logistics); Valio Aimo cannot confirm the quantity.',
  },
  PARTIAL_AVAILABILITY: {
    severity: 'needs_approval',
    source: 'aimo',
    title: 'Partial availability',
    description: 'Less than the requested quantity is available on the requested date.',
  },
  AFTER_CUTOFF: {
    severity: 'needs_approval',
    source: 'aimo',
    title: 'After order cut-off',
    description: 'The order cut-off time for the requested delivery date has already passed.',
  },
  DELIVERY_LATER_THAN_NEEDED: {
    severity: 'needs_approval',
    source: 'aimo',
    title: 'Delivery too late',
    description: 'The earliest available delivery date is after the date the buyer needs the goods.',
  },
  SALES_BLOCK: {
    severity: 'blocked',
    source: 'aimo',
    title: 'Sales block',
    description: 'Valio Aimo has blocked sales of this product; it cannot be ordered right now.',
  },
  OFFER_EXPIRED: {
    severity: 'blocked',
    source: 'aimo',
    title: 'Offer expired',
    description: 'The signed offer is no longer valid; request fresh offers.',
  },
  OFFER_SIGNATURE_INVALID: {
    severity: 'blocked',
    source: 'aimo',
    title: 'Invalid offer signature',
    description: 'The offer was altered or not signed by Valio Aimo; the price cannot be trusted.',
  },
  MANDATE_EXPIRED: {
    severity: 'blocked',
    source: 'mandate',
    title: 'Mandate expired',
    description: 'The buyer mandate presented by the agent is expired or not yet valid.',
  },
  UNKNOWN_AGENT: {
    severity: 'blocked',
    source: 'aimo',
    title: 'Unknown agent',
    description: 'The agent is not registered with Valio Aimo for this customer.',
  },
  QUERY_BUDGET_EXCEEDED: {
    severity: 'blocked',
    source: 'aimo',
    title: 'Query budget exceeded',
    description: 'The agent exceeded its allowed number of price/availability queries.',
  },
};

/** Derive the decision status from a list of reason codes (see module doc). */
export function decisionStatusFor(codes: readonly ReasonCode[]): DecisionStatus {
  if (codes.some((c) => REASON_CODE_INFO[c].severity === 'blocked')) return 'blocked';
  if (codes.length > 0) return 'needs_approval';
  return 'auto_approved';
}
