import { describe, expect, it, vi } from 'vitest';
import { cheapest, runAgent } from '../src/agent';
import { MockGateway } from '../src/gateway';
import { createProvider } from '../src/llm';

const NOW = new Date('2026-11-13T18:00:00Z'); // Friday
const DEMO = 'I need 1,000 litres of lactose-free milk by Monday';
const llm = createProvider({ LLM_PROVIDER: 'none' });
// the trust root is built once from the mock's published keys, out of band
const deps = async (gateway: MockGateway, published: MockGateway = gateway) => ({
  llm,
  gateway,
  now: () => NOW,
  mandate: { maxOrderTotalEur: 5000 },
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
    expect(result.chosen?.product.id).toBe('LF-CASE12');
    expect(result.chosen?.pack.note).toContain('84 packs × 12 L = 1,008 L (+8 L)');
    // never proposes the cheaper regular milk: it is not lactose-free
    expect(result.trace.map((s) => s.output).join(' ')).not.toContain('MILK-1L');
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: 'LF-BIB10', reasonCode: 'PARTIAL_AVAILABILITY' }),
        expect.objectContaining({ productId: 'LF-ORG-1L', reasonCode: 'DELIVERY_LATER_THAN_NEEDED' }),
        // cheapest of all, but sales-blocked
        expect.objectContaining({ productId: 'LF-BLOCKED', reasonCode: 'SALES_BLOCK' }),
      ]),
    );

    expect(result.trace.map((s) => s.action)).toEqual(
      expect.arrayContaining(['parse_need', 'search_products', 'get_offers', 'verify_offer', 'select_offer', 'pack_math', 'propose_order']),
    );
    for (const step of result.trace) {
      expect(step.input).toBeTruthy();
      expect(step.output).toBeTruthy();
    }

    const order = await gateway.getOrder({ order_id: result.order!.orderId });
    expect(order).toMatchObject({ status: 'placed', quantities: [84] });
    expect((await gateway.explain({ order_id: order.orderId })).text).toContain('auto_approved');
  });

  it('does not order when offer prices are tampered', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const genuine = gateway.getOffers.bind(gateway);
    gateway.getOffers = async (input) => (await genuine(input)).map((signed) => ({ ...signed, offer: { ...signed.offer, unitPrice: 0.01 } }));
    const propose = vi.spyOn(gateway, 'proposeOrder');

    const result = await runAgent(DEMO, await deps(gateway));

    expect(propose).not.toHaveBeenCalled();
    expect(result.ordered).toBe(false);
    expect(result.order).toBeUndefined();
    expect(result.decision).toEqual({ status: 'blocked', reasonCodes: ['OFFER_SIGNATURE_INVALID'] });
  });

  it('skips a single tampered offer and orders a genuine one', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const genuine = gateway.getOffers.bind(gateway);
    gateway.getOffers = async (input) =>
      (await genuine(input)).map((signed) => (signed.offer.productId === 'LF-CASE12' ? { ...signed, offer: { ...signed.offer, unitPrice: 0.01 } } : signed));

    const result = await runAgent(DEMO, await deps(gateway));

    expect(result.ordered).toBe(true);
    expect(result.chosen?.product.id).toBe('LF-1L');
    expect(result.rejected).toContainEqual(expect.objectContaining({ productId: 'LF-CASE12', reasonCode: 'OFFER_SIGNATURE_INVALID' }));
  });

  it('does not order when offers are expired', async () => {
    // gateway clock one hour behind: its 15 minute offers are already stale for the agent
    const gateway = new MockGateway({ now: () => new Date(NOW.getTime() - 3_600_000) });
    const propose = vi.spyOn(gateway, 'proposeOrder');

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

  it('routes an order above the mock auto-approve limit to approval', async () => {
    const gateway = new MockGateway({ now: () => NOW, autoApproveLimit: 100 });
    const result = await runAgent(DEMO, await deps(gateway));
    expect(result.decision).toEqual({ status: 'needs_approval', reasonCodes: ['OVER_AUTO_LIMIT'] });
    const approved = await gateway.approveOrder({ order_id: result.order!.orderId, approver: 'chef' });
    expect(approved.status).toBe('placed');
  });

  it('lets a custom selector replace the cheapest-offer rule', async () => {
    const result = await runAgent(DEMO, {
      ...(await deps(new MockGateway({ now: () => NOW }))),
      select: (candidates) => candidates.find((c) => c.product.id === 'LF-1L'),
    });
    expect(result.chosen?.product.id).toBe('LF-1L');
    expect(result.chosen?.pack.note).toBe('1,000 L → 1,000 packs × 1 L');
  });

  it('trusts only the configured keys, not the JWKS of the gateway that serves the offers', async () => {
    const genuine = new MockGateway({ now: () => NOW });
    // a look-alike gateway signs its own offers and would happily publish its own JWKS
    const impostor = new MockGateway({ now: () => NOW });
    const getJwks = vi.spyOn(impostor, 'getJwks');
    const propose = vi.spyOn(impostor, 'proposeOrder');

    const result = await runAgent(DEMO, await deps(impostor, genuine));

    expect(getJwks).not.toHaveBeenCalled();
    expect(propose).not.toHaveBeenCalled();
    expect(result.ordered).toBe(false);
    expect(result.decision).toEqual({ status: 'blocked', reasonCodes: ['OFFER_SIGNATURE_INVALID'] });
  });

  it('re-reads the clock and does not propose an offer that expired after verification', async () => {
    const gateway = new MockGateway({ now: () => NOW });
    const propose = vi.spyOn(gateway, 'proposeOrder');
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
});
