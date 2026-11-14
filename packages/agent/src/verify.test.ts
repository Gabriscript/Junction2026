import { describe, expect, it } from 'vitest';
import { MockGateway, type MockGatewayOptions } from './gateway.js';
import { MAX_OFFER_TTL_MS, verifyOffer } from './verify.js';

const NOW = new Date('2026-11-13T18:00:00Z');

async function setup(options: MockGatewayOptions = {}) {
  const gateway = new MockGateway({ now: () => NOW, ...options });
  const [offer] = await gateway.getOffers({ product_ids: ['LF-CASE12'], quantity: 1000, unit: 'L' });
  if (!offer) throw new Error('the mock returned no offer');
  // the trust root is built once from the published keys, out of band
  return { gateway, offer, trust: { issuer: 'mock-gateway', jwks: await gateway.getJwks() } };
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('verifyOffer', () => {
  it('accepts a genuine offer and returns the signed payload', async () => {
    const { offer, trust } = await setup();
    const result = await verifyOffer(offer, trust, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.offer).toMatchObject({ productId: 'LF-CASE12', unitPrice: 14.4 });
  });

  it('rejects a tampered plain price', async () => {
    const { offer, trust } = await setup();
    expect(await verifyOffer({ ...offer, offer: { ...offer.offer, unitPrice: 0.01 } }, trust, NOW)).toEqual({ ok: false, reasonCode: 'OFFER_SIGNATURE_INVALID' });
  });

  it('rejects a price tampered inside the JWS payload', async () => {
    const { offer, trust } = await setup();
    const [header, payload, signature] = offer.jws.split('.');
    const forged = { ...JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()), unitPrice: 0.01 };
    const jws = [header, b64url(forged), signature].join('.');
    expect(await verifyOffer({ offer: forged, jws }, trust, NOW)).toEqual({ ok: false, reasonCode: 'OFFER_SIGNATURE_INVALID' });
  });

  it('rejects an offer signed by another key', async () => {
    const { offer } = await setup();
    const otherJwks = await new MockGateway({ now: () => NOW }).getJwks();
    expect(await verifyOffer(offer, { issuer: 'mock-gateway', jwks: otherJwks }, NOW)).toMatchObject({ ok: false, reasonCode: 'OFFER_SIGNATURE_INVALID' });
  });

  it('rejects unsigned (alg none) and malformed offers', async () => {
    const { offer, trust } = await setup();
    const payload = offer.jws.split('.')[1];
    const unsigned = `${b64url({ alg: 'none' })}.${payload}.`;
    for (const bad of [{ ...offer, jws: unsigned }, { ...offer, jws: 'garbage' }, { ...offer, jws: undefined }, null, 'offer']) {
      expect(await verifyOffer(bad, trust, NOW)).toMatchObject({ ok: false, reasonCode: 'OFFER_SIGNATURE_INVALID' });
    }
  });

  it('rejects an offer whose signed issuer is not the trusted issuer', async () => {
    const { offer, trust } = await setup();
    expect(await verifyOffer(offer, { ...trust, issuer: 'someone-else' }, NOW)).toEqual({ ok: false, reasonCode: 'OFFER_SIGNATURE_INVALID' });
  });

  it('rejects an expired offer, allowing 60 s of clock skew', async () => {
    const { offer, trust } = await setup();
    const until = Date.parse(offer.offer.validUntil);
    expect(await verifyOffer(offer, trust, new Date(until + 60_000))).toEqual({ ok: false, reasonCode: 'OFFER_EXPIRED' });
    expect(await verifyOffer(offer, trust, new Date(until + 59_999))).toMatchObject({ ok: true });
  });

  it('rejects not-yet-valid and over-long validity windows as OFFER_EXPIRED', async () => {
    // gateway clock 5 minutes ahead: validFrom is in the agent's future, beyond the skew
    const future = await setup({ now: () => new Date(NOW.getTime() + 5 * 60_000) });
    expect(await verifyOffer(future.offer, future.trust, NOW)).toEqual({ ok: false, reasonCode: 'OFFER_EXPIRED' });
    const skewed = await setup({ now: () => new Date(NOW.getTime() + 30_000) });
    expect(await verifyOffer(skewed.offer, skewed.trust, NOW)).toMatchObject({ ok: true });

    const longLived = await setup({ offerTtlMs: MAX_OFFER_TTL_MS + 1 });
    expect(await verifyOffer(longLived.offer, longLived.trust, NOW)).toEqual({ ok: false, reasonCode: 'OFFER_EXPIRED' });
    const maxTtl = await setup({ offerTtlMs: MAX_OFFER_TTL_MS });
    expect(await verifyOffer(maxTtl.offer, maxTtl.trust, NOW)).toMatchObject({ ok: true });
  });
});
