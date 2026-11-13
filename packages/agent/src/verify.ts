import { isDeepStrictEqual } from 'node:util';
import { compactVerify, createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { Offer, SignedOffer, type ReasonCode } from './contract';

export type OfferVerification = { ok: true; offer: Offer } | { ok: false; reasonCode: ReasonCode };

const INVALID: OfferVerification = { ok: false, reasonCode: 'OFFER_SIGNATURE_INVALID' };

/**
 * Verifies a signed offer against the gateway JWKS. Callers must use the returned
 * offer, never the plain copy they were handed: only the JWS payload is signed.
 */
export async function verifyOffer(offer: unknown, jwks: JSONWebKeySet, now: Date): Promise<OfferVerification> {
  const parsed = SignedOffer.safeParse(offer);
  if (!parsed.success) return INVALID;

  let signed: Offer;
  try {
    // pinning ES256 also rejects "alg: none" and algorithm swaps
    const verified = await compactVerify(parsed.data.jws, createLocalJWKSet(jwks), { algorithms: ['ES256'] });
    signed = Offer.parse(JSON.parse(new TextDecoder().decode(verified.payload)));
  } catch {
    return INVALID;
  }

  // the plain offer is a readable copy: if it differs from what was signed, someone edited it
  if (!isDeepStrictEqual(parsed.data.offer, signed)) return INVALID;

  if (Date.parse(signed.validUntil) <= now.getTime()) return { ok: false, reasonCode: 'OFFER_EXPIRED' };
  return { ok: true, offer: signed };
}
