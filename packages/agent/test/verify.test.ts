import { describe, expect, it } from 'vitest';
import { MockGateway } from '../src/gateway';
import { verifyOffer } from '../src/verify';

const NOW = new Date('2026-11-13T18:00:00Z');

async function setup() {
  const gateway = new MockGateway({ now: () => NOW });
  const [offer] = await gateway.getOffers({ product_ids: ['LF-CASE12'], quantity: 1000, unit: 'L' });
  return { gateway, offer, jwks: await gateway.getJwks() };
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('verifyOffer', () => {
  it('accepts a genuine offer and returns the signed payload', async () => {
    const { offer, jwks } = await setup();
    const result = await verifyOffer(offer, jwks, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.offer).toMatchObject({ productId: 'LF-CASE12', unitPrice: 14.4 });
  });

  it('rejects a tampered plain price', async () => {
    const { offer, jwks } = await setup();
    expect(await verifyOffer({ ...offer, offer: { ...offer.offer, unitPrice: 0.01 } }, jwks, NOW)).toEqual({ ok: false, reasonCode: 'OFFER_SIGNATURE_INVALID' });
  });

  it('rejects a price tampered inside the JWS payload', async () => {
    const { offer, jwks } = await setup();
    const [header, payload, signature] = offer.jws.split('.');
    const forged = { ...JSON.parse(Buffer.from(payload, 'base64url').toString()), unitPrice: 0.01 };
    const jws = [header, b64url(forged), signature].join('.');
    expect(await verifyOffer({ offer: forged, jws }, jwks, NOW)).toEqual({ ok: false, reasonCode: 'OFFER_SIGNATURE_INVALID' });
  });

  it('rejects an offer signed by another key', async () => {
    const { offer } = await setup();
    const otherJwks = await new MockGateway({ now: () => NOW }).getJwks();
    expect(await verifyOffer(offer, otherJwks, NOW)).toMatchObject({ ok: false, reasonCode: 'OFFER_SIGNATURE_INVALID' });
  });

  it('rejects unsigned (alg none) and malformed offers', async () => {
    const { offer, jwks } = await setup();
    const payload = offer.jws.split('.')[1];
    const unsigned = `${b64url({ alg: 'none' })}.${payload}.`;
    for (const bad of [{ ...offer, jws: unsigned }, { ...offer, jws: 'garbage' }, { ...offer, jws: undefined }, null, 'offer']) {
      expect(await verifyOffer(bad, jwks, NOW)).toMatchObject({ ok: false, reasonCode: 'OFFER_SIGNATURE_INVALID' });
    }
  });

  it('rejects an expired offer, including exactly at validUntil', async () => {
    const { offer, jwks } = await setup();
    const at = new Date(offer.offer.validUntil);
    expect(await verifyOffer(offer, jwks, at)).toEqual({ ok: false, reasonCode: 'OFFER_EXPIRED' });
    expect(await verifyOffer(offer, jwks, new Date(at.getTime() - 1))).toMatchObject({ ok: true });
  });
});
