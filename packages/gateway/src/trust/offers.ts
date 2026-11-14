/**
 * Signed offers: JWS (ES256) over `canonicalJson(offer)`; VC-shaped payload per shared `Offer`.
 *
 * `verifyOfferJws` is what the agent (and the policy engine) use before relying on a price.
 * It returns a reason code instead of throwing, so policy can turn it into a decision.
 */
import { CompactSign, compactVerify, createLocalJWKSet, decodeProtectedHeader, type CryptoKey, type JWK } from 'jose';
import { canonicalJson, OfferSchema, type Offer, type ReasonCode, type SignedOffer } from '@junction/shared';
import { SIGNING_ALG, type Jwks, type SigningKey } from './keys.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function signOffer(offer: Offer, key: SigningKey): Promise<SignedOffer> {
  const payload = canonicalJson(OfferSchema.parse(offer));
  const jws = await new CompactSign(enc.encode(payload))
    .setProtectedHeader({ alg: SIGNING_ALG, kid: key.kid, typ: 'aimo-offer+json' })
    .sign(key.privateKey);
  return { offer, jws };
}

export type OfferVerification =
  | { ok: true; offer: Offer; kid: string | undefined }
  | { ok: false; code: Extract<ReasonCode, 'OFFER_SIGNATURE_INVALID' | 'OFFER_EXPIRED'>; message: string };

export interface VerifyOptions {
  /** Instant to check validity against (default: now). */
  now?: Date;
  /** When given, the decoded payload must equal this offer (byte-wise after canonicalisation). */
  expectOffer?: Offer;
}

/** Keys accepted by `verifyOfferJws`: the gateway key, a JWKS document, or a raw public key. */
export type VerifyKeys = SigningKey | Jwks | CryptoKey | JWK;

function keyResolver(keys: VerifyKeys) {
  if ('keys' in keys && Array.isArray(keys.keys)) return createLocalJWKSet(keys as Jwks);
  if ('publicKey' in keys) return (keys as SigningKey).publicKey;
  return keys as CryptoKey | JWK;
}

export async function verifyOfferJws(jws: string, keys: VerifyKeys, opts: VerifyOptions = {}): Promise<OfferVerification> {
  let kid: string | undefined;
  let payloadText: string;
  try {
    kid = decodeProtectedHeader(jws).kid;
    const resolver = keyResolver(keys);
    const { payload } = await compactVerify(jws, resolver as CryptoKey, { algorithms: [SIGNING_ALG] });
    payloadText = dec.decode(payload);
  } catch (e) {
    return { ok: false, code: 'OFFER_SIGNATURE_INVALID', message: `Offer signature did not verify (${(e as Error).message || 'invalid JWS'})` };
  }
  let offer: Offer;
  try {
    const parsed = OfferSchema.safeParse(JSON.parse(payloadText));
    if (!parsed.success) return { ok: false, code: 'OFFER_SIGNATURE_INVALID', message: 'Signed payload is not a valid offer' };
    offer = parsed.data;
  } catch {
    return { ok: false, code: 'OFFER_SIGNATURE_INVALID', message: 'Signed payload is not JSON' };
  }
  if (canonicalJson(offer) !== payloadText) {
    return { ok: false, code: 'OFFER_SIGNATURE_INVALID', message: 'Signed payload is not in canonical form' };
  }
  if (opts.expectOffer && canonicalJson(opts.expectOffer) !== payloadText) {
    return { ok: false, code: 'OFFER_SIGNATURE_INVALID', message: `Offer ${offer.offerId}: the presented offer differs from the signed payload` };
  }
  const now = opts.now ?? new Date();
  const until = new Date(offer.validUntil);
  const from = new Date(offer.validFrom);
  if (now.getTime() > until.getTime()) {
    return { ok: false, code: 'OFFER_EXPIRED', message: `Offer ${offer.offerId} expired at ${offer.validUntil}` };
  }
  if (now.getTime() < from.getTime()) {
    return { ok: false, code: 'OFFER_EXPIRED', message: `Offer ${offer.offerId} is not valid before ${offer.validFrom}` };
  }
  return { ok: true, offer, kid };
}
