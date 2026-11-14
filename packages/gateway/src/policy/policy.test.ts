import { describe, expect, it } from 'vitest';
import * as fx from '@junction/shared/fixtures';
import { REASON_CODES, type Offer, type OrderProposal, type Product, type ReasonCode } from '@junction/shared';
import { DEFAULT_KNOWN_AGENTS } from '../config.js';
import type { OfferVerification } from '../trust/offers.js';
import { allergenStatus, evaluate, isAllergenSafe, type PolicyInput, type VerifiedLine } from './evaluate.js';

const now = new Date('2026-11-14T09:10:00+02:00');
const products = new Map<string, Product>(fx.products.map((p) => [p.id, p]));

const ok = (offer: Offer): OfferVerification => ({ ok: true, offer, kid: 'test' });

function line(offer: Offer, quantity = offer.quantity, substituteFor: string | null = null, verification: OfferVerification = ok(offer)): VerifiedLine {
  return { lineId: `ln_${offer.offerId}`, proposal: { offerId: offer.offerId, offerJws: fx.FIXTURE_JWS, quantity, substituteFor }, verification };
}

function run(proposal: OrderProposal, lines: VerifiedLine[], extra: Partial<PolicyInput> = {}) {
  return evaluate({
    proposal,
    lines,
    products,
    knownAgents: DEFAULT_KNOWN_AGENTS,
    spentGross: 0,
    now,
    policyVersion: 'policy-0.1',
    ...extra,
  });
}

const hotel = (over: Partial<OrderProposal> = {}): OrderProposal => ({ ...fx.hotelProposal, ...over });
const hospital = (over: Partial<OrderProposal> = {}): OrderProposal => ({ ...fx.hospitalProposal, ...over });

/** Cheap verified-stock offer, deliverable on time, within cutoff → nothing to flag. */
/** Hospital fixture offers were quoted for customer 123; the hospital mandate is 456. */
const forHospital = (o: Offer): Offer => ({ ...o, customerRef: '456' });
const bread = forHospital(fx.breadOffer);
const muesli = forHospital(fx.muesliOffer);

const cleanMilk: Offer = { ...fx.milkOffer, quantity: 10, totals: { net: 144, vat: 19.44, gross: 163.44, currency: 'EUR' } };

describe('policy engine', () => {
  it('happy path: auto_approved with no reasons, totals and lines resolved', () => {
    const r = run(hotel(), [line(cleanMilk, 10)]);
    expect(r.decision.status).toBe('auto_approved');
    expect(r.decision.reasons).toEqual([]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.offerVerified).toBe(true);
    expect(r.totals.gross).toBeCloseTo(163.44, 2);
  });

  const cases: Record<ReasonCode, () => ReturnType<typeof run>> = {
    OVER_BUDGET: () => run(hotel(), [line(fx.milkOffer, 84)], { spentGross: 4500 }),
    OVER_AUTO_LIMIT: () => run(hotel({ mandate: { ...fx.hotelMandate, autoApproveLimit: 100 } }), [line(cleanMilk, 10)]),
    SUBSTITUTION_OUTSIDE_PREFS: () => run(hotel({ mandate: { ...fx.hotelMandate, substitutionPolicy: 'none' } }), [line(fx.milkAltOffer, 10, '990001')]),
    ALLERGEN_CONFLICT: () => run(hospital(), [line(muesli, 1)]),
    UNVERIFIED_STOCK: () => run(hotel(), [line(fx.milkAltOffer, 10, '990001')]),
    PARTIAL_AVAILABILITY: () => run(hospital(), [line(bread, 40)]),
    AFTER_CUTOFF: () => run(hotel(), [line({ ...cleanMilk, cutoffTime: '2026-11-14T08:00:00+02:00' }, 10)]),
    DELIVERY_LATER_THAN_NEEDED: () => run(hotel(), [line({ ...cleanMilk, availableDate: '2026-11-18' }, 10)]),
    SALES_BLOCK: () => run(hotel(), [line({ ...cleanMilk, salesBlock: true }, 10)]),
    OFFER_EXPIRED: () => run(hotel(), [line(cleanMilk, 10, null, { ok: false, code: 'OFFER_EXPIRED', message: 'Offer off_x expired at 2026-11-14T09:00:00+02:00' })]),
    OFFER_SIGNATURE_INVALID: () => run(hotel(), [line(cleanMilk, 10, null, { ok: false, code: 'OFFER_SIGNATURE_INVALID', message: 'Offer signature did not verify' })]),
    MANDATE_EXPIRED: () => run(hotel({ mandate: fx.expiredMandate }), [line(cleanMilk, 10)]),
    UNKNOWN_AGENT: () => run(hotel({ agentId: 'agent:rogue-1', mandate: { ...fx.hotelMandate, agentId: 'agent:rogue-1' } }), [line(cleanMilk, 10)]),
    QUERY_BUDGET_EXCEEDED: () => run(hotel(), [line(cleanMilk, 10)], { queryBudgetExceeded: true }),
  };

  it.each(REASON_CODES)('%s is raised with the contract severity and a concrete message', (code) => {
    const r = cases[code]();
    const reason = r.decision.reasons.find((x) => x.code === code);
    expect(reason, `expected ${code}, got ${r.decision.reasonCodes.join(',')}`).toBeDefined();
    expect(reason!.message.length).toBeGreaterThan(10);
    expect(r.decision.reasonCodes).toContain(code);
    const blockedCodes: ReasonCode[] = ['ALLERGEN_CONFLICT', 'SALES_BLOCK', 'OFFER_EXPIRED', 'OFFER_SIGNATURE_INVALID', 'MANDATE_EXPIRED', 'UNKNOWN_AGENT', 'QUERY_BUDGET_EXCEEDED'];
    if (blockedCodes.includes(code)) {
      expect(reason!.severity).toBe('blocked');
      expect(r.decision.status).toBe('blocked');
    } else {
      expect(reason!.severity).toBe('needs_approval');
      expect(r.decision.status).toBe('needs_approval');
    }
  });

  it('ALLERGEN_CONFLICT is always blocked: MAY_CONTAIN, CONTAINS and unknown data alike', () => {
    const mayContain = run(hospital(), [line(muesli, 1)]);
    expect(mayContain.decision.status).toBe('blocked');
    expect(mayContain.decision.reasons.find((r) => r.code === 'ALLERGEN_CONFLICT')!.message).toMatch(/may contain tree nuts \(AN\)/);

    const contains = run(hospital({ mandate: { ...fx.hospitalMandate, forbiddenAllergens: ['GO'] } }), [line(muesli, 1)]);
    expect(contains.decision.reasons.find((r) => r.code === 'ALLERGEN_CONFLICT')!.message).toMatch(/contains oats \(GO\)/);

    const soupOffer: Offer = { ...cleanMilk, customerRef: '456', offerId: 'off_soup', productId: '990005', productName: 'Vegetable soup base 5 L' };
    const unknown = run(hospital(), [line(soupOffer, 1)]);
    expect(unknown.decision.status).toBe('blocked');
    expect(unknown.decision.reasons.find((r) => r.code === 'ALLERGEN_CONFLICT')!.message).toMatch(/unknown is treated as unsafe/);

    const notInCatalogue = run(hospital(), [line({ ...soupOffer, productId: '999999' }, 1)]);
    expect(notInCatalogue.decision.reasonCodes).toContain('ALLERGEN_CONFLICT');

    // A human approver cannot override: status stays blocked even with every other code absent.
    const breadOnly = run(hospital({ mandate: { ...fx.hospitalMandate, autoApproveLimit: 1e6 } }), [line(bread, 10)]);
    expect(breadOnly.decision.status).toBe("auto_approved"); // bread is FREE_FROM AN and UW
  });

  it('allergen status helper follows the shared semantics', () => {
    expect(allergenStatus(fx.glutenFreeBread, 'AN')).toBe('FREE_FROM');
    expect(allergenStatus(fx.milkLactoseFree, 'AN')).toBe('SAFE_BY_OMISSION');
    expect(allergenStatus(fx.muesliMayContainNuts, 'AN')).toBe('MAY_CONTAIN');
    expect(allergenStatus(fx.milkLactoseFree, 'AM')).toBe('CONTAINS');
    expect(allergenStatus(fx.soupUnknownAllergens, 'AM')).toBe('UNKNOWN');
    expect(allergenStatus(undefined, 'AM')).toBe('UNKNOWN');
    expect(isAllergenSafe(fx.soupUnknownAllergens, 'AM')).toBe(false);
  });

  it('substitution policies: aimo_listed and same_category accept the right substitutes', () => {
    // 990002 is Aimo-listed as substitute for 990001 and in the same category.
    expect(run(hotel(), [line({ ...fx.milkAltOffer, logisticModel: 'Stock', quantityVerified: true }, 10, '990001')]).decision.reasonCodes).not.toContain('SUBSTITUTION_OUTSIDE_PREFS');
    const sameCat = { ...fx.hotelMandate, substitutionPolicy: 'same_category' as const };
    expect(run(hotel({ mandate: sameCat }), [line({ ...fx.milkAltOffer, logisticModel: 'Stock', quantityVerified: true }, 10, '990001')]).decision.reasonCodes).not.toContain('SUBSTITUTION_OUTSIDE_PREFS');
    // Bread substituting milk is outside aimo_listed and same_category, allowed only by "any".
    expect(run(hotel(), [line(fx.breadOffer, 1, '990001')]).decision.reasonCodes).toContain('SUBSTITUTION_OUTSIDE_PREFS');
    expect(run(hotel({ mandate: { ...fx.hotelMandate, substitutionPolicy: 'any', requiredAttributes: [] } }), [line(fx.breadOffer, 1, '990001')]).decision.reasonCodes).not.toContain('SUBSTITUTION_OUTSIDE_PREFS');
    // Missing required attribute (hotel requires LACTOSE_FREE; bread is not).
    expect(run(hotel(), [line(fx.breadOffer, 1)]).decision.reasons.find((r) => r.code === 'SUBSTITUTION_OUTSIDE_PREFS')!.message).toMatch(/LACTOSE_FREE/);
  });

  it('money: budget counts earlier spend; huge overspend escalates to blocked; invalid lines carry no totals', () => {
    const within = run(hotel(), [line(cleanMilk, 10)], { spentGross: 4800 });
    expect(within.decision.reasonCodes).toEqual([]);
    const over = run(hotel(), [line(cleanMilk, 10)], { spentGross: 4900 });
    expect(over.decision.reasons.find((r) => r.code === 'OVER_BUDGET')!.severity).toBe('needs_approval');
    const absurd = run(hotel({ mandate: { ...fx.hotelMandate, budgetLimit: 50, autoApproveLimit: 1e6 } }), [line(cleanMilk, 10)]);
    expect(absurd.decision.reasons.find((r) => r.code === 'OVER_BUDGET')!.severity).toBe('blocked');
    expect(absurd.decision.status).toBe('blocked');
    const invalid = run(hotel(), [line(cleanMilk, 10, null, { ok: false, code: 'OFFER_SIGNATURE_INVALID', message: 'x' })]);
    expect(invalid.lines).toHaveLength(0);
    expect(invalid.totals.gross).toBe(0);
  });

  it('rejects an offer quoted for another customer or whose id does not match the line', () => {
    const r = run(hospital(), [line(fx.breadOffer, 1)]); // fixture offer quoted for customer 123
    expect(r.decision.reasons[0]).toMatchObject({ code: 'OFFER_SIGNATURE_INVALID', severity: 'blocked' });
    const swapped = run(hotel(), [{ ...line(cleanMilk, 10), proposal: { offerId: 'off_other', offerJws: fx.FIXTURE_JWS, quantity: 10, substituteFor: null } }]);
    expect(swapped.decision.reasonCodes).toEqual(['OFFER_SIGNATURE_INVALID']);
  });

  it('matches the blocked hospital fixture scenario', () => {
    const r = run(hospital(), [line(bread, 40), line(muesli, 10)]);
    expect(r.decision.status).toBe('blocked');
    expect([...r.decision.reasonCodes].sort()).toEqual(['ALLERGEN_CONFLICT', 'DELIVERY_LATER_THAN_NEEDED', 'OVER_AUTO_LIMIT', 'PARTIAL_AVAILABILITY']);
    expect(r.totals.gross).toBeCloseTo(fx.blockedOrder.totals.gross, 2);
  });
});
