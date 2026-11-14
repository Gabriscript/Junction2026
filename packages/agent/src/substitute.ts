import type { Mandate, Product } from '@junction/shared';
import { clean, type Candidate } from './agent.js';
import type { Unit } from './contract.js';
import { packMath, orderableLot } from './packMath.js';

/** One order line of the plan. `substituteFor` is the primary product it stands in for, null for the primary itself. */
export interface PlanLine {
  candidate: Candidate;
  packs: number;
  substituteFor: string | null;
  netCents: number;
  grossCents: number;
  /** Why this line was added, for the approver. Absent on the primary line. */
  reason?: string;
}

/** A verified offer and how many packs of it can actually be delivered in time. */
export interface Usable {
  candidate: Candidate;
  maxPacks: number;
}

// money in integer cents: VAT as percent × 100 (13.5 → 1350), one half-up rounding of an exact integer fraction
export const toCents = (euros: number) => Math.floor(euros * 100 + 0.5 + 1e-9);
const vatCents = (netCents: number, vatRate: number) => Math.floor((netCents * Math.round(vatRate * 100) + 5000) / 10000);
/** Net and gross cents of `packs` of an offer, per line as the gateway does (it rounds each line, then sums). */
export function lineCents(unitPrice: number, vatRate: number, packs: number) {
  const netCents = toCents(packs * unitPrice);
  return { netCents, grossCents: netCents + vatCents(netCents, vatRate) };
}

/** The gateway's substitution rule (policy/evaluate.ts), mirrored so the agent knows in advance what needs approval. */
export function allowedSubstitute(policy: Mandate['substitutionPolicy'], original: Product, substitute: Product): boolean {
  if (policy === 'any') return true;
  if (policy === 'aimo_listed') return original.substitutes.includes(substitute.id);
  if (policy === 'same_category') return original.category === substitute.category;
  return false;
}

const POLICY_WORDS: Record<Mandate['substitutionPolicy'], string> = {
  any: 'substitutes allowed by the mandate',
  aimo_listed: 'listed by Valio Aimo as a substitute',
  same_category: 'same category',
  none: 'no substitutes allowed',
};

/** Price of one need unit (L, KG, piece) in cents: the fair way to compare packs of different sizes. */
const perUnit = (c: Candidate) => toCents(c.offer.unitPrice) / c.pack.packSize;

/**
 * Fills the need with the cheapest product per unit first, even if it is short, then the next cheapest
 * allowed products. Only the last line rounds up, so the overshoot stays on one line. Returns undefined
 * when the usable offers together cannot cover the need.
 * `strict`: use only substitutes the mandate allows; otherwise any, and the gateway asks a human.
 */
export function planFill(usable: Usable[], need: { quantity: number; unit: Unit }, policy: Mandate['substitutionPolicy'], strict: boolean): PlanLine[] | undefined {
  const sorted = [...usable].filter((u) => u.maxPacks > 0).sort((a, b) => perUnit(a.candidate) - perUnit(b.candidate));
  // one line per product: two offers for the same product would count its stock twice
  const seen = new Set<string>();
  const unique = sorted.filter((u) => !seen.has(u.candidate.product.id) && seen.add(u.candidate.product.id));
  const [primary, ...rest] = unique;
  if (!primary) return undefined;
  const fillers = rest.filter((u) => !strict || allowedSubstitute(policy, primary.candidate.product, u.candidate.product));

  const lines: PlanLine[] = [];
  let remaining = need.quantity;
  for (const u of [primary, ...fillers]) {
    if (remaining <= 1e-9) break;
    const { candidate } = u;
    const packs = Math.min(u.maxPacks, packMath({ quantity: remaining, unit: need.unit }, candidate.pack.packSize, orderableLot(candidate.product)).packs);
    remaining -= packs * candidate.pack.packSize;
    const isPrimary = u === primary;
    lines.push({
      candidate,
      packs,
      substituteFor: isPrimary ? null : primary.candidate.product.id,
      ...lineCents(candidate.offer.unitPrice, candidate.offer.vatRate, packs),
      ...(isPrimary ? {} : { reason: reasonFor(primary, candidate, packs, policy, need.unit) }),
    });
  }
  return remaining > 1e-9 ? undefined : lines;
}

/** Deterministic approver text, e.g. "only 40 of 100 packs of X available → added 50 × Y, same category, LACTOSE_FREE, +14 % per L". */
export function reasonFor(primary: Usable, substitute: Candidate, packs: number, policy: Mandate['substitutionPolicy'], unit: Unit): string {
  const original = primary.candidate;
  const allowed = allowedSubstitute(policy, original.product, substitute.product);
  const delta = Math.round((perUnit(substitute) / perUnit(original) - 1) * 100);
  const attributes = substitute.product.attributes.join(', ');
  return (
    `only ${primary.maxPacks} of ${original.pack.packs} packs of ${clean(original.product.name)} available → added ${packs} × ${clean(substitute.product.name)}, ` +
    `${allowed ? POLICY_WORDS[policy] : `outside the mandate policy (${POLICY_WORDS[policy]}), needs approval`}` +
    `${attributes ? `, ${attributes}` : ''}, ${delta >= 0 ? '+' : ''}${delta} % per ${unit}`
  );
}
