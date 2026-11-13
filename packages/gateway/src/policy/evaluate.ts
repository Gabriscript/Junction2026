/**
 * Policy engine: buyer mandate + Valio Aimo rules → `Decision` with reason codes.
 *
 * Pure and deterministic: everything it needs (verified offers, catalogue products, the static
 * agent list, spend so far, the clock) is passed in. Severities come from the shared
 * `REASON_CODE_INFO` defaults; the engine may escalate but never downgrade.
 */
import {
  decisionStatusFor,
  REASON_CODE_INFO,
  roundEur,
  totalsFromNet,
  type Decision,
  type DecisionReason,
  type Mandate,
  type Offer,
  type OrderLine,
  type OrderProposal,
  type Product,
  type ProposalLine,
  type ReasonCode,
  type Totals,
} from '@junction/shared';
import type { KnownAgent } from '../config.js';
import { allergenName } from '../catalogue/allergens.js';
import type { OfferVerification } from '../trust/offers.js';

export interface VerifiedLine {
  lineId: string;
  proposal: ProposalLine;
  verification: OfferVerification;
}

export interface PolicyInput {
  proposal: OrderProposal;
  lines: readonly VerifiedLine[];
  /** Catalogue products by id (for allergens, categories, substitutes). Missing = unknown. */
  products: ReadonlyMap<string, Product>;
  knownAgents: readonly KnownAgent[];
  /** Gross EUR already committed (auto-approved + approved orders) under this mandate. */
  spentGross: number;
  /** Set when the agent is over its query budget (tracked by the gateway). */
  queryBudgetExceeded?: boolean;
  now: Date;
  policyVersion: string;
}

export interface PolicyResult {
  decision: Decision;
  lines: OrderLine[];
  totals: Totals;
}

const eur = (n: number) => `€${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Allergen safety for one GS1 code (shared semantics with `search_products`):
 * explicit FREE_FROM, or allergen data present with no CONTAINS/MAY_CONTAIN for the code.
 * No allergen data at all = unknown = unsafe.
 */
export function allergenStatus(product: Product | undefined, code: string): 'FREE_FROM' | 'CONTAINS' | 'MAY_CONTAIN' | 'SAFE_BY_OMISSION' | 'UNKNOWN' {
  if (!product || product.allergens.length === 0) return 'UNKNOWN';
  const entries = product.allergens.filter((a) => a.code === code);
  if (entries.some((a) => a.level === 'CONTAINS')) return 'CONTAINS';
  if (entries.some((a) => a.level === 'MAY_CONTAIN')) return 'MAY_CONTAIN';
  if (entries.some((a) => a.level === 'FREE_FROM')) return 'FREE_FROM';
  return 'SAFE_BY_OMISSION';
}

export function isAllergenSafe(product: Product | undefined, code: string): boolean {
  const s = allergenStatus(product, code);
  return s === 'FREE_FROM' || s === 'SAFE_BY_OMISSION';
}

function lineFromOffer(lineId: string, offer: Offer, p: ProposalLine): OrderLine {
  return {
    lineId,
    offerId: offer.offerId,
    productId: offer.productId,
    productName: offer.productName,
    quantity: p.quantity,
    unit: offer.unit,
    unitPrice: offer.unitPrice,
    vatRate: offer.vatRate,
    totals: totalsFromNet(p.quantity * offer.unitPrice, offer.vatRate),
    availableDate: offer.availableDate,
    substituteFor: p.substituteFor,
    offerVerified: true,
  };
}

function sumTotals(lines: readonly OrderLine[]): Totals {
  const net = roundEur(lines.reduce((s, l) => s + l.totals.net, 0));
  const vat = roundEur(lines.reduce((s, l) => s + l.totals.vat, 0));
  return { net, vat, gross: roundEur(net + vat), currency: 'EUR' };
}

export function evaluate(input: PolicyInput): PolicyResult {
  const { proposal, now } = input;
  const mandate: Mandate = proposal.mandate;
  const reasons: DecisionReason[] = [];
  const add = (code: ReasonCode, message: string, lineId?: string, escalate?: 'blocked') => {
    const def = REASON_CODE_INFO[code].severity;
    const severity = escalate === 'blocked' ? 'blocked' : def;
    reasons.push(lineId ? { code, severity, lineId, message } : { code, severity, message });
  };

  // ---- identity / authority -------------------------------------------------------------
  const agent = input.knownAgents.find((a) => a.agentId === proposal.agentId);
  if (!agent) {
    add('UNKNOWN_AGENT', `Agent ${proposal.agentId} is not registered with Valio Aimo.`);
  } else if (!agent.customerRefs.includes(mandate.customerRef)) {
    add('UNKNOWN_AGENT', `Agent ${proposal.agentId} is not registered for customer ${mandate.customerRef}.`);
  }
  if (mandate.agentId !== proposal.agentId) {
    add('UNKNOWN_AGENT', `Mandate ${mandate.mandateId} authorises ${mandate.agentId}, not the calling agent ${proposal.agentId}.`);
  }
  if (input.queryBudgetExceeded) {
    add('QUERY_BUDGET_EXCEEDED', `Agent ${proposal.agentId} exceeded its price/availability query budget.`);
  }
  const t = now.getTime();
  if (t > new Date(mandate.validUntil).getTime()) {
    add('MANDATE_EXPIRED', `Mandate ${mandate.mandateId} expired at ${mandate.validUntil}.`);
  } else if (t < new Date(mandate.validFrom).getTime()) {
    add('MANDATE_EXPIRED', `Mandate ${mandate.mandateId} is not valid before ${mandate.validFrom}.`);
  }

  // ---- lines ------------------------------------------------------------------------------
  const lines: OrderLine[] = [];
  for (const vl of input.lines) {
    const { lineId, proposal: pl, verification } = vl;
    if (!verification.ok) {
      add(verification.code, verification.message, lineId);
      continue;
    }
    const offer = verification.offer;
    if (offer.offerId !== pl.offerId) {
      add('OFFER_SIGNATURE_INVALID', `Line references offer ${pl.offerId} but the JWS is for ${offer.offerId}.`, lineId);
      continue;
    }
    if (offer.customerRef !== mandate.customerRef) {
      add('OFFER_SIGNATURE_INVALID', `Offer ${offer.offerId} was quoted for customer ${offer.customerRef}, mandate is for ${mandate.customerRef}.`, lineId);
      continue;
    }
    lines.push(lineFromOffer(lineId, offer, pl));
    const product = input.products.get(offer.productId);
    const label = offer.productName;

    // Aimo rules
    if (offer.salesBlock) add('SALES_BLOCK', `${label} is sales-blocked by Valio Aimo.`, lineId);
    if (offer.availableQuantity === null || offer.availableDate === null) {
      add('PARTIAL_AVAILABILITY', `${label} cannot currently be delivered (no schedule line).`, lineId);
    } else {
      if (!offer.quantityVerified) {
        add('UNVERIFIED_STOCK', `${label} ships from the supplier (Terminal); Valio Aimo cannot confirm ${pl.quantity} ${offer.unit}.`, lineId);
      } else if (offer.availableQuantity < pl.quantity) {
        add('PARTIAL_AVAILABILITY', `Only ${offer.availableQuantity} of ${pl.quantity} ${offer.unit} of ${label} available on ${offer.availableDate}.`, lineId);
      }
      if (offer.availableDate > proposal.neededBy) {
        add('DELIVERY_LATER_THAN_NEEDED', `${label}: earliest delivery ${offer.availableDate}, needed by ${proposal.neededBy}.`, lineId);
      }
    }
    if (offer.cutoffTime && t > new Date(offer.cutoffTime).getTime()) {
      add('AFTER_CUTOFF', `${label}: order cut-off ${offer.cutoffTime} has passed.`, lineId);
    }

    // Mandate: allergens (hard constraint; unknown = unsafe)
    for (const code of mandate.forbiddenAllergens) {
      const status = allergenStatus(product, code);
      if (status === 'FREE_FROM' || status === 'SAFE_BY_OMISSION') continue;
      const name = allergenName(code) ?? code;
      const why =
        status === 'UNKNOWN'
          ? `has no allergen data for ${name} (${code}) — unknown is treated as unsafe`
          : `${status === 'CONTAINS' ? 'contains' : 'may contain'} ${name} (${code})`;
      add('ALLERGEN_CONFLICT', `${label} ${why}; forbidden by the mandate.`, lineId);
    }

    // Mandate: required attributes and categories (preferences → approval)
    for (const attr of mandate.requiredAttributes) {
      if (!product || !product.attributes.includes(attr)) {
        add('SUBSTITUTION_OUTSIDE_PREFS', `${label} ${product ? 'lacks' : 'is not in the catalogue, cannot confirm'} the required attribute ${attr}.`, lineId);
      }
    }
    if (mandate.allowedCategories && (!product || !mandate.allowedCategories.includes(product.category))) {
      add('SUBSTITUTION_OUTSIDE_PREFS', `${label} is outside the categories allowed by the mandate.`, lineId);
    }

    // Mandate: substitution policy
    if (pl.substituteFor) {
      const original = input.products.get(pl.substituteFor);
      const policy = mandate.substitutionPolicy;
      let allowed = false;
      if (policy === 'any') allowed = true;
      else if (policy === 'aimo_listed') allowed = !!original?.substitutes.includes(offer.productId);
      else if (policy === 'same_category') allowed = !!original && !!product && original.category === product.category;
      if (!allowed) {
        add('SUBSTITUTION_OUTSIDE_PREFS', `${label} substitutes ${pl.substituteFor}, which the mandate's substitution policy "${policy}" does not allow.`, lineId);
      }
    }
  }

  // ---- money ------------------------------------------------------------------------------
  const totals = sumTotals(lines);
  if (lines.length > 0) {
    if (totals.gross > mandate.autoApproveLimit) {
      add('OVER_AUTO_LIMIT', `Order total ${eur(totals.gross)} is above the ${eur(mandate.autoApproveLimit)} auto-approve limit.`);
    }
    const remaining = roundEur(mandate.budgetLimit - input.spentGross);
    if (totals.gross > remaining) {
      // Escalate when the order alone is more than double the whole budget: no approver can fix that.
      const escalate = totals.gross > mandate.budgetLimit * 2 ? 'blocked' : undefined;
      add('OVER_BUDGET', `Order total ${eur(totals.gross)} exceeds the remaining mandate budget ${eur(Math.max(remaining, 0))} (of ${eur(mandate.budgetLimit)}).`, undefined, escalate);
    }
  }

  const reasonCodes = [...new Set(reasons.map((r) => r.code))];
  let status = decisionStatusFor(reasonCodes);
  if (reasons.some((r) => r.severity === 'blocked')) status = 'blocked';
  return {
    decision: { status, reasonCodes, reasons, decidedAt: now.toISOString(), policyVersion: input.policyVersion },
    lines,
    totals,
  };
}
