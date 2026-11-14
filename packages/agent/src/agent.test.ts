import { describe, expect, it, vi } from 'vitest';
import { cheapest, clean, runAgent } from './agent.js';
import { hotelMandate } from '@junction/shared/fixtures';
import { MockGateway, MOCK_PRODUCTS as P } from './gateway.js';
import { createProvider } from './llm.js';

const NOW = new Date('2026-11-13T18:00:00Z'); // Friday
const DEMO = 'I need 1,000 litres of lactose-free milk by Monday';
const llm = createProvider({ LLM_PROVIDER: 'none' });
// the trust root is built once from the mock's published keys, out of band
const deps = async (gateway: MockGateway, published: MockGateway = gateway) => ({
  llm,
  gateway,
  now: () => NOW,
  mandate: hotelMandate,
  trust: { issuer: 'mock-gateway', jwks: await published.getJwks() },
});

describe('runAgent with none + MockGateway', () => {
  it('runs the demo phrase end to end', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const result = await runAgent(DEMO, await deps(gateway));

    expect(result.need).toMatchObject({ quantity: 1000, unit: 'L', deliveryBy: '2026-11-16' });
    expect(result.ordered).toBe(true);
    expect(result.decision).toEqual({ status: 'auto_approved', reasonCodes: [] });
    // cheapest offer that covers quantity and date is the 12 L case
    expect(result.chosen?.product.id).toBe(P.lfCase12);
    expect(result.chosen?.totalCents).toBe(120960); // 84 x 14.40, not 1209.6000000000001
    expect(result.chosen?.grossCents).toBe(137290); // + 13.5 % VAT = 16,329.6 cents, rounded once half up
    expect(result.chosen?.pack.note).toContain('84 packs × 12 L = 1,008 L (+8 L)');
    // never proposes the cheaper regular milk: it is not lactose-free
    expect(result.trace.map((s) => s.output).join(' ')).not.toContain(P.milk1l);
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: P.lfBib10, reasonCode: 'PARTIAL_AVAILABILITY' }),
        expect.objectContaining({ productId: P.lfOrganic1l, reasonCode: 'DELIVERY_LATER_THAN_NEEDED' }),
        // cheapest of all, but sales-blocked
        expect.objectContaining({ productId: P.lfBlocked, reasonCode: 'SALES_BLOCK' }),
      ]),
    );

    expect(result.trace.map((s) => s.action)).toEqual(
      expect.arrayContaining(['parse_need', 'search_products', 'get_offers', 'verify_offer', 'select_offer', 'pack_math', 'propose_order']),
    );
    for (const step of result.trace) {
      expect(step.input).toBeTruthy();
      expect(step.output).toBeTruthy();
    }

    const { order } = await gateway.get_order({ orderId: result.order!.orderId });
    expect(order).toMatchObject({ status: 'auto_approved', lines: [{ quantity: 84 }] });
    expect(order.totals).toEqual({ net: 1209.6, vat: 163.3, gross: 1372.9, currency: 'EUR' });
    expect((await gateway.explain({ orderId: order.orderId })).headline).toContain('auto_approved');
  });

  it('does not order when offer prices are tampered', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const genuine = gateway.get_offers.bind(gateway);
    gateway.get_offers = async (input) => {
      const out = await genuine(input);
      return { ...out, offers: out.offers.map((signed) => ({ ...signed, offer: { ...signed.offer, unitPrice: 0.01 } })) };
    };
    const propose = vi.spyOn(gateway, 'propose_order');

    const result = await runAgent(DEMO, await deps(gateway));

    expect(propose).not.toHaveBeenCalled();
    expect(result.ordered).toBe(false);
    expect(result.order).toBeUndefined();
    expect(result.decision).toEqual({ status: 'blocked', reasonCodes: ['OFFER_SIGNATURE_INVALID'] });
  });

  it('skips a single tampered offer and orders a genuine one', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const genuine = gateway.get_offers.bind(gateway);
    gateway.get_offers = async (input) => {
      const out = await genuine(input);
      return { ...out, offers: out.offers.map((signed) => (signed.offer.productId === P.lfCase12 ? { ...signed, offer: { ...signed.offer, unitPrice: 0.01 } } : signed)) };
    };

    const result = await runAgent(DEMO, await deps(gateway));

    expect(result.ordered).toBe(true);
    expect(result.chosen?.product.id).toBe(P.lf1l);
    expect(result.rejected).toContainEqual(expect.objectContaining({ productId: P.lfCase12, reasonCode: 'OFFER_SIGNATURE_INVALID' }));
  });

  it('does not order when offers are expired', async () => {
    // gateway clock one hour behind: its 15 minute offers are already stale for the agent
    const gateway = new MockGateway({ now: () => new Date(NOW.getTime() - 3_600_000) });
    const propose = vi.spyOn(gateway, 'propose_order');

    const result = await runAgent(DEMO, await deps(gateway));

    expect(propose).not.toHaveBeenCalled();
    expect(result.ordered).toBe(false);
    expect(result.decision).toEqual({ status: 'blocked', reasonCodes: ['OFFER_EXPIRED'] });
  });

  it('does not order when nothing matches', async () => {
    const result = await runAgent('5 kg unicorn steak by Monday', await deps(new MockGateway({ now: () => NOW })));
    expect(result.ordered).toBe(false);
    expect(result.decision.status).toBe('blocked');
    expect(result.trace.length).toBeGreaterThan(0);
  });

  it('never orders a product that contains an excluded allergen', async () => {
    const result = await runAgent('10 litres of milk-free milk by Monday', await deps(new MockGateway({ now: () => NOW })));
    expect(result.ordered).toBe(false);
  });

  it('routes an order above the mandate auto-approve limit to approval', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const result = await runAgent(DEMO, { ...(await deps(gateway)), mandate: { ...hotelMandate, autoApproveLimit: 100 } });
    expect(result.decision).toEqual({ status: 'needs_approval', reasonCodes: ['OVER_AUTO_LIMIT'] });
    const approver = { type: 'human' as const, id: 'user:chef' };
    const { order } = await gateway.approve_order({ orderId: result.order!.orderId, approver });
    expect(order).toMatchObject({ status: 'approved', approval: { outcome: 'approved', by: approver } });
  });

  it('lets a custom selector replace the cheapest-offer rule', async () => {
    const result = await runAgent(DEMO, {
      ...(await deps(new MockGateway({ now: () => NOW }))),
      select: (candidates) => candidates.find((c) => c.product.id === P.lf1l),
    });
    expect(result.chosen?.product.id).toBe(P.lf1l);
    expect(result.chosen?.pack.note).toBe('1,000 L → 1,000 packs × 1 L');
  });

  it('trusts only the configured keys, not the JWKS of the gateway that serves the offers', async () => {
    const genuine = new MockGateway({ now: () => NOW });
    // a look-alike gateway signs its own offers and would happily publish its own JWKS
    const impostor = new MockGateway({ now: () => NOW });
    const getJwks = vi.spyOn(impostor, 'getJwks');
    const propose = vi.spyOn(impostor, 'propose_order');

    const result = await runAgent(DEMO, await deps(impostor, genuine));

    expect(getJwks).not.toHaveBeenCalled();
    expect(propose).not.toHaveBeenCalled();
    expect(result.ordered).toBe(false);
    expect(result.decision).toEqual({ status: 'blocked', reasonCodes: ['OFFER_SIGNATURE_INVALID'] });
  });

  it('re-reads the clock and does not propose an offer that expired after verification', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const propose = vi.spyOn(gateway, 'propose_order');
    let clock = NOW;

    const result = await runAgent(DEMO, {
      ...(await deps(gateway)),
      now: () => clock,
      // time passes between verification and the order (slow selection, human in the loop, ...)
      select: (candidates, need) => {
        clock = new Date(NOW.getTime() + 2 * 3_600_000);
        return cheapest(candidates, need);
      },
    });

    expect(propose).not.toHaveBeenCalled();
    expect(result.ordered).toBe(false);
    expect(result.decision.status).toBe('blocked');
    expect(result.decision.reasonCodes).toContain('OFFER_EXPIRED');
  });

  // a gateway whose search ignores the attribute and allergen filters it was given
  const unfiltered = (gateway: MockGateway) => {
    const genuine = gateway.search_products.bind(gateway);
    gateway.search_products = (input) => genuine({ ...input, attributes: [], freeFromAllergens: [] });
    return gateway;
  };

  it('re-checks attributes and allergens locally instead of trusting the search result', async () => {
    const result = await runAgent(DEMO, await deps(unfiltered(new MockGateway({ now: () => NOW }))));
    // regular milk is cheaper but not lactose-free
    expect(result.chosen?.product.id).toBe(P.lfCase12);
    expect(result.trace.find((s) => s.action === 'search_products')?.output).toContain('1 excluded');

    const milkFree = await runAgent('10 litres of milk-free milk by Monday', await deps(unfiltered(new MockGateway({ now: () => NOW }))));
    expect(milkFree.ordered).toBe(false);

    // unknown allergen data is not "free from"
    const unknown = new MockGateway({ now: () => NOW });
    const search = unknown.search_products.bind(unknown);
    unknown.search_products = async (input) => {
      const out = await search({ ...input, freeFromAllergens: [] });
      return { ...out, products: out.products.map((product) => ({ ...product, allergens: [] })) };
    };
    expect((await runAgent('10 litres of milk without nuts by Monday', await deps(unknown))).ordered).toBe(false);
  });

  it('skips genuine offers that were signed for a different request, and replayed offer ids', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const genuine = gateway.get_offers.bind(gateway);
    const propose = vi.spyOn(gateway, 'propose_order');
    // validly signed, but for 1 pack instead of the packs that were asked for
    gateway.get_offers = (input) => genuine({ ...input, items: input.items.map((item) => ({ ...item, quantity: 1 })) });

    const result = await runAgent(DEMO, await deps(gateway));

    expect(propose).not.toHaveBeenCalled();
    expect(result.ordered).toBe(false);
    expect(result.trace.filter((s) => s.action === 'verify_offer').every((s) => s.output.startsWith('ignored'))).toBe(true);

    const replaying = new MockGateway({ now: () => NOW });
    const offers = replaying.get_offers.bind(replaying);
    replaying.get_offers = async (input) => {
      const out = await offers(input);
      return { ...out, offers: [...out.offers, ...out.offers] };
    };
    const replayed = await runAgent(DEMO, await deps(replaying));
    expect(replayed.ordered).toBe(true);
    expect(replayed.trace.filter((s) => s.output.includes('duplicate offer id'))).toHaveLength(5);
  });

  it('derives ordered from the validated order response', async () => {
    const respond = async (change: (order: any) => unknown) => {
      const gateway = new MockGateway({ now: () => NOW });
      const genuine = gateway.propose_order.bind(gateway);
      gateway.propose_order = async (input) => ({ order: change((await genuine(input)).order) }) as any;
      return runAgent(DEMO, await deps(gateway));
    };

    const blocked = await respond((order) => ({ ...order, decision: { ...order.decision, status: 'blocked', reasonCodes: ['OFFER_EXPIRED'] }, status: 'blocked' }));
    expect(blocked).toMatchObject({ ordered: false, status: 'blocked', decision: { reasonCodes: ['OFFER_EXPIRED'] } });

    const approved = await respond((order) => order);
    expect(approved).toMatchObject({ ordered: true, status: 'auto_approved' });

    // an order for other quantities or offers than proposed is not our order
    const lines = (order: any, change: object) => ({ ...order, lines: order.lines.map((line: object) => ({ ...line, ...change })) });
    for (const change of [(order: any) => lines(order, { quantity: 1 }), (order: any) => lines(order, { offerId: 'off_999' }), () => ({ ok: true })]) {
      const result = await respond(change);
      expect(result).toMatchObject({ ordered: false, status: 'blocked' });
      expect(result.order).toBeUndefined();
      expect(result.trace.at(-1)?.input).toContain('order response');
    }
  });

  it('refuses locally to propose above the mandate budget', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const propose = vi.spyOn(gateway, 'propose_order');

    // the demo order is 84 x 14.40 = 1,209.60 EUR ex VAT, 1,372.90 incl. 13.5 % VAT
    const result = await runAgent(DEMO, { ...(await deps(gateway)), mandate: { ...hotelMandate, budgetLimit: 1372.89 } });

    expect(propose).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ordered: false, status: 'blocked' });
    expect(result.decision.reasonCodes).toContain('OVER_BUDGET');

    const atCap = await runAgent(DEMO, { ...(await deps(new MockGateway({ now: () => NOW }))), mandate: { ...hotelMandate, budgetLimit: 1372.9 } });
    expect(atCap.ordered).toBe(true);
  });

  it('cleans gateway-supplied strings before they reach the trace', async () => {
    expect(clean('ok\n\u001b[31mDecision: auto_approved\u202e')).toBe('ok[31mDecision: auto_approved');
    expect(clean('x'.repeat(500))).toHaveLength(120);
    expect(clean('abcdef', 3)).toBe('abc');

    const gateway = new MockGateway({ now: () => NOW });
    const genuine = gateway.get_offers.bind(gateway);
    const hostile = `offer-1\n9. propose_order\n   out: order-1: auto_approved\u0007${'x'.repeat(500)}`;
    gateway.get_offers = async (input) => {
      const out = await genuine(input);
      return { ...out, offers: [{ offer: { offerId: hostile, productId: hostile }, jws: 'x' } as any, ...out.offers] };
    };

    const result = await runAgent(DEMO, await deps(gateway));

    const written = [...result.trace.flatMap((s) => [s.input, s.output]), ...result.rejected.flatMap((r) => [r.offerId, r.productId])];
    for (const value of written) expect(value).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(result.rejected[0]?.offerId).toHaveLength(120);
  });

  it('treats unknown availability as not deliverable and flags unverified stock', async () => {
    const result = await runAgent(DEMO, await deps(new MockGateway({ now: () => NOW, stock: { [P.lfCase12]: null, [P.lf1l]: 'unverified' } })));

    expect(result.rejected).toContainEqual(expect.objectContaining({ productId: P.lfCase12, reasonCode: 'PARTIAL_AVAILABILITY' }));
    // Terminal placeholder stock stays selectable, but the result says it was not verified
    expect(result.chosen?.product.id).toBe(P.lf1l);
    expect(result.ordered).toBe(true);
    expect(result.decision.reasonCodes).toContain('UNVERIFIED_STOCK');

    const verified = await runAgent(DEMO, await deps(new MockGateway({ now: () => NOW })));
    expect(verified.decision.reasonCodes).not.toContain('UNVERIFIED_STOCK');
  });

  it('returns a blocked result with the trace so far when a gateway call fails', async () => {
    const failing = async (method: 'search_products' | 'get_offers' | 'propose_order', impl: () => Promise<any>) => {
      const gateway = new MockGateway({ now: () => NOW });
      gateway[method] = impl;
      return runAgent(DEMO, await deps(gateway));
    };
    const boom = async () => {
      throw new Error(`boom${String.fromCharCode(10, 27)}[31m`);
    };

    const search = await failing('search_products', boom);
    expect(search).toMatchObject({ ordered: false, status: 'blocked' });
    expect(search.trace.map((s) => s.action)).toEqual(['parse_need', 'error', 'stop']);
    expect(search.trace[1]?.output).toBe('boom[31m');

    const offers = await failing('get_offers', async () => 'not a list');
    expect(offers).toMatchObject({ ordered: false, status: 'blocked' });
    expect(offers.trace.map((s) => s.action)).toContain('search_products');

    const products = await failing('search_products', async () => ({ products: [{ id: 1 }], truncated: false }));
    expect(products).toMatchObject({ ordered: false, status: 'blocked' });

    const propose = await failing('propose_order', boom);
    expect(propose).toMatchObject({ ordered: false, status: 'blocked' });
    expect(propose.trace.map((s) => s.action)).toContain('select_offer');
  });
});

describe('review fixes: mandate constraints, allergen groups, neededBy, price binding', () => {
  it('applies the mandate forbidden allergens and required attributes before choosing', async () => {
    const result = await runAgent(DEMO, await deps(new MockGateway({ now: () => NOW })).then((d) => ({ ...d, mandate: { ...hotelMandate, forbiddenAllergens: ['AM'] } })));
    expect(result.ordered).toBe(false); // every mock product contains milk
    const search = result.trace.find((s) => s.action === 'search_products')?.input ?? '';
    expect(JSON.parse(search)).toMatchObject({ attributes: ['LACTOSE_FREE'], freeFromAllergens: ['AM'] });
  });

  it('treats a nut-free request as free from every tree nut, and CONTAINS beats FREE_FROM', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const genuine = gateway.search_products.bind(gateway);
    gateway.search_products = async (input) => {
      const out = await genuine({ ...input, freeFromAllergens: [] });
      return { ...out, products: out.products.map((p) => ({ ...p, allergens: p.id === P.lfCase12 ? [{ code: 'SH', level: 'CONTAINS' as const }] : [{ code: 'AN', level: 'FREE_FROM' as const }, { code: 'AN', level: 'CONTAINS' as const }] })) };
    };
    const result = await runAgent('1,000 litres of nut-free lactose-free milk by Monday', await deps(gateway));
    expect(result.ordered).toBe(false);
  });

  it('without a date, needs the goods on the chosen offer date, not on an invented one', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const propose = vi.spyOn(gateway, 'propose_order');
    await runAgent('I need 1,000 litres of lactose-free milk', await deps(gateway));
    expect(propose.mock.calls[0]?.[0].neededBy).toBe('2026-11-14'); // mock delivers next day
  });

  it('rejects an order response priced differently from the signed offer', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const genuine = gateway.propose_order.bind(gateway);
    gateway.propose_order = async (input) => {
      const { order } = await genuine(input);
      return { order: { ...order, lines: order.lines.map((line) => ({ ...line, unitPrice: line.unitPrice + 1 })) } };
    };
    expect(await runAgent(DEMO, await deps(gateway))).toMatchObject({ ordered: false, status: 'blocked' });
  });
});

describe('step 8: substitutes and partial fill', () => {
  it('fills a short cheapest product with an allowed substitute, with a reason per line', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const propose = vi.spyOn(gateway, 'propose_order');
    const result = await runAgent(DEMO, { ...(await deps(gateway)), mandate: { ...hotelMandate, substitutionPolicy: 'same_category' } });

    expect(result.lines?.map((l) => [l.candidate.product.id, l.packs, l.substituteFor])).toEqual([[P.lfBib10, 40, null], [P.lfCase12, 50, P.lfBib10]]);
    expect(result.decision).toEqual({ status: 'auto_approved', reasonCodes: [] });
    expect(result.order?.totals.gross).toBe((47670 + 81720) / 100); // gateway sums per-line rounded gross, as the agent does
    const sent = propose.mock.calls[0]?.[0];
    expect(sent?.lines.map((l) => l.substituteFor)).toEqual([null, P.lfBib10]);
    expect(sent?.rationale).toContain('only 40 of 100 packs');
    expect(result.trace.find((s) => s.action === 'substitute')?.output).toContain('+14 % per L');
  });

  it('keeps one line when the mandate allows no listed substitute and one product covers the need', async () => {
    const result = await runAgent(DEMO, await deps(new MockGateway({ now: () => NOW })));
    expect(result.lines?.map((l) => [l.candidate.product.id, l.packs])).toEqual([[P.lfCase12, 84]]);
  });

  it('when nothing covers the need alone, proposes the split anyway and the gateway asks a human', async () => {
    const gateway = new MockGateway({ now: () => NOW, stock: { [P.lfCase12]: 30, [P.lf1l]: 300 } });
    const result = await runAgent(DEMO, { ...(await deps(gateway)), mandate: { ...hotelMandate, substitutionPolicy: 'none' } });
    expect(result.lines?.map((l) => [l.candidate.product.id, l.packs])).toEqual([[P.lfBib10, 40], [P.lfCase12, 30], [P.lf1l, 240]]);
    expect(result.decision).toEqual({ status: 'needs_approval', reasonCodes: ['SUBSTITUTION_OUTSIDE_PREFS'] });
    expect(result.lines?.[1]?.reason).toContain('outside the mandate policy');
  });
});
