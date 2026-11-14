import { describe, expect, it } from 'vitest';
import type { Candidate } from './agent.js';
import { allowedSubstitute, lineCents, planFill, type Usable } from './substitute.js';

// only the fields planFill reads
const usable = (id: string, packSize: number, unitPrice: number, maxPacks: number, extra: { category?: string; substitutes?: string[]; lot?: number; need?: number } = {}): Usable => {
  const packs = Math.ceil((extra.need ?? 1000) / packSize);
  const candidate = {
    offer: { offerId: `off_${id}`, unitPrice, vatRate: 13.5 },
    product: { id, name: `P${id}`, category: extra.category ?? 'c1', substitutes: extra.substitutes ?? [], attributes: ['LACTOSE_FREE'], pack: { allowedLotSize: extra.lot ?? 1 } },
    pack: { packSize, packs },
  } as unknown as Candidate;
  return { candidate, maxPacks };
};
const need = { quantity: 1000, unit: 'L' as const };

describe('planFill', () => {
  it('takes the cheapest per unit first, then fills with the next cheapest allowed product', () => {
    const plan = planFill([usable('bib', 10, 10.5, 40), usable('case', 12, 14.4, 84), usable('one', 1, 1.35, 1000)], need, 'same_category', true)!;
    expect(plan.map((l) => [l.candidate.product.id, l.packs, l.substituteFor])).toEqual([['bib', 40, null], ['case', 50, 'bib']]);
    expect(plan.reduce((total, l) => total + l.packs * l.candidate.pack.packSize, 0)).toBe(1000);
  });

  it('strict mode keeps only substitutes the mandate allows', () => {
    const offers = [usable('bib', 10, 10.5, 40), usable('case', 12, 14.4, 84, { category: 'c2' })];
    expect(planFill(offers, need, 'same_category', true)).toBeUndefined(); // nothing allowed covers the rest
    expect(planFill(offers, need, 'same_category', false)?.map((l) => l.packs)).toEqual([40, 50]);
  });

  it('caps short lines at the lot size and rounds up only the last line', () => {
    // the caller floors stock to the lot (45 → 44); 44 × 7 = 308 L, the rest 692 L → 58 × 12 = 696 L, overshoot only here
    const plan = planFill([usable('a', 7, 7, 44, { lot: 2 }), usable('b', 12, 14.4, 84)], need, 'any', true)!;
    expect(plan.map((l) => l.packs)).toEqual([44, 58]);
  });

  it('allowedSubstitute mirrors the gateway policy', () => {
    const a = usable('a', 1, 1, 1, { substitutes: ['b'] }).candidate.product as any;
    const b = usable('b', 1, 1, 1).candidate.product as any;
    const c = usable('c', 1, 1, 1, { category: 'c2' }).candidate.product as any;
    expect([allowedSubstitute('any', a, c), allowedSubstitute('none', a, b), allowedSubstitute('aimo_listed', a, b), allowedSubstitute('aimo_listed', a, c), allowedSubstitute('same_category', a, b), allowedSubstitute('same_category', a, c)]).toEqual([true, false, true, false, true, false]);
  });

  it('writes a deterministic reason and integer line money', () => {
    const plan = planFill([usable('bib', 10, 10.5, 40), usable('case', 12, 14.4, 84)], need, 'same_category', true)!;
    expect(plan[1]?.reason).toBe('only 40 of 100 packs of Pbib available → added 50 × Pcase, same category, LACTOSE_FREE, +14 % per L');
    expect(lineCents(14.4, 13.5, 50)).toEqual({ netCents: 72000, grossCents: 81720 });
  });
});
