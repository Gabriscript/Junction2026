import { isDeepStrictEqual } from 'node:util';
import { compactVerify, createLocalJWKSet, createRemoteJWKSet, type JSONWebKeySet } from 'jose';
import { Offer, SignedOffer, type ReasonCode } from './contract';

export type OfferVerification = { ok: true; offer: Offer } | { ok: false; reasonCode: ReasonCode };

/**
 * Who the agent trusts to sign offers. It comes from configuration, never from the
 * gateway that serves the offers: a gateway that hands out its own keys proves nothing.
 */
export interface Trust {
  issuer: string;
  jwks: JSONWebKeySet | URL;
}

export const CLOCK_SKEW_MS = 60_000;
export const MAX_OFFER_TTL_MS = 60 * 60 * 1000;

const INVALID: OfferVerification = { ok: false, reasonCode: 'OFFER_SIGNATURE_INVALID' };

type KeyResolver = ReturnType<typeof createLocalJWKSet> | ReturnType<typeof createRemoteJWKSet>;
// one resolver per trust root, so a remote JWKS is fetched and cached once, not once per offer
const resolvers = new WeakMap<object, KeyResolver>();
function keysOf(jwks: JSONWebKeySet | URL): KeyResolver {
  let resolver = resolvers.get(jwks);
  if (!resolver) {
    resolver = jwks instanceof URL ? createRemoteJWKSet(jwks) : createLocalJWKSet(jwks);
    resolvers.set(jwks, resolver);
  }
  return resolver;
}

/**
 * True when `now` is inside the offer's validity window, with CLOCK_SKEW_MS of tolerance.
 * Not yet valid (validFrom in the future) and a window that ends more than MAX_OFFER_TTL_MS
 * from now also count as "not current": callers report all three as OFFER_EXPIRED, which
 * here means "validity window invalid", not only "validUntil has passed".
 */
export function offerIsCurrent(offer: Offer, now: Date): boolean {
  const at = now.getTime();
  const until = Date.parse(offer.validUntil);
  if (until <= at - CLOCK_SKEW_MS) return false;
  if (until - at > MAX_OFFER_TTL_MS) return false;
  if (offer.validFrom && Date.parse(offer.validFrom) > at + CLOCK_SKEW_MS) return false;
  return true;
}

/**
 * Verifies a signed offer against the trusted issuer and its keys. Callers must use the
 * returned offer, never the plain copy they were handed: only the JWS payload is signed.
 */
export async function verifyOffer(offer: unknown, trust: Trust, now: Date): Promise<OfferVerification> {
  const parsed = SignedOffer.safeParse(offer);
  if (!parsed.success) return INVALID;

  let signed: Offer;
  try {
    // pinning ES256 also rejects "alg: none" and algorithm swaps
    const verified = await compactVerify(parsed.data.jws, keysOf(trust.jwks), { algorithms: ['ES256'] });
    signed = Offer.parse(JSON.parse(new TextDecoder().decode(verified.payload)));
  } catch {
    return INVALID;
  }

  // the plain offer is a readable copy: if it differs from what was signed, someone edited it
  if (!isDeepStrictEqual(parsed.data.offer, signed)) return INVALID;
  // a valid signature from the right key on an offer that names another issuer is still not ours
  if (signed.issuer !== trust.issuer) return INVALID;

  if (!offerIsCurrent(signed, now)) return { ok: false, reasonCode: 'OFFER_EXPIRED' };
  return { ok: true, offer: signed };
}
