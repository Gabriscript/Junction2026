import { describe, expect, it } from 'vitest';
import * as fx from '@junction/shared/fixtures';
import { parseOutput, validateInput, type GatewayClient } from './gateway-client.js';

describe('agent ↔ shared contract', () => {
  it('validates inputs and parses outputs with the shared schemas', () => {
    expect(() => validateInput('propose_order', fx.hotelProposal)).not.toThrow();
    expect(() => validateInput('get_offers', { ...fx.getMilkOffersInput, items: [] })).toThrow();
    const out = parseOutput('get_offers', fx.getMilkOffersOutput);
    expect(out.offers.map((o) => o.offer.productId)).toEqual(['990001', '990002']);
  });

  it('a fixture-backed client satisfies the GatewayClient type', async () => {
    const order = { order: fx.autoApprovedOrder };
    const mock: GatewayClient = {
      search_products: async () => fx.searchMilkOutput,
      get_offers: async () => fx.getMilkOffersOutput,
      propose_order: async () => order,
      approve_order: async () => ({ order: fx.approvedOrder }),
      reject_order: async () => order,
      get_order: async () => order,
      explain: async () => fx.pendingExplanation,
    };
    const res = await mock.propose_order(fx.hotelProposal);
    expect(res.order.decision.status).toBe('auto_approved');
  });
});
