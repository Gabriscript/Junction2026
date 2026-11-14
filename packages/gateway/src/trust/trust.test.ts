import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fx from '@junction/shared/fixtures';
import { generateSigningKey, jwksFor, loadSigningKey, type SigningKey } from './keys.js';
import { signOffer, verifyOfferJws } from './offers.js';

let key: SigningKey;
const now = new Date('2026-11-14T09:10:00+02:00'); // inside the fixture validity window

beforeAll(async () => {
  key = (await generateSigningKey()).key;
});

describe('signed offers', () => {
  it('sign → verify roundtrip, with the gateway key and with the published JWKS', async () => {
    const signed = await signOffer(fx.milkOffer, key);
    expect(signed.jws.split('.')).toHaveLength(3);
    const a = await verifyOfferJws(signed.jws, key, { now });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.offer).toEqual(fx.milkOffer);
      expect(a.kid).toBe(key.kid);
    }
    const jwks = jwksFor(key);
    expect(jwks.keys[0]).not.toHaveProperty('d');
    expect(jwks.keys[0]!.alg).toBe('ES256');
    const b = await verifyOfferJws(signed.jws, jwks, { now, expectOffer: fx.milkOffer });
    expect(b.ok).toBe(true);
  });

  it('tampered price → OFFER_SIGNATURE_INVALID', async () => {
    const signed = await signOffer(fx.milkOffer, key);
    const [h, p, s] = signed.jws.split('.') as [string, string, string];
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as { unitPrice: number };
    payload.unitPrice = 0.01;
    const tampered = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    const r = await verifyOfferJws(tampered, key, { now });
    expect(r).toMatchObject({ ok: false, code: 'OFFER_SIGNATURE_INVALID' });
    // Offer copy that differs from the signed payload is also rejected.
    const r2 = await verifyOfferJws(signed.jws, key, { now, expectOffer: { ...fx.milkOffer, unitPrice: 0.01 } });
    expect(r2).toMatchObject({ ok: false, code: 'OFFER_SIGNATURE_INVALID' });
  });

  it('wrong key / fixture JWS → OFFER_SIGNATURE_INVALID', async () => {
    const other = (await generateSigningKey()).key;
    const signed = await signOffer(fx.milkOffer, key);
    expect(await verifyOfferJws(signed.jws, other, { now })).toMatchObject({ ok: false, code: 'OFFER_SIGNATURE_INVALID' });
    expect(await verifyOfferJws(fx.FIXTURE_JWS, jwksFor(key), { now })).toMatchObject({ ok: false, code: 'OFFER_SIGNATURE_INVALID' });
    expect(await verifyOfferJws('not-a-jws', key, { now })).toMatchObject({ ok: false, code: 'OFFER_SIGNATURE_INVALID' });
  });

  it('expired → OFFER_EXPIRED', async () => {
    const signed = await signOffer(fx.milkOffer, key);
    const late = new Date('2026-11-14T09:31:00+02:00');
    const r = await verifyOfferJws(signed.jws, key, { now: late });
    expect(r).toMatchObject({ ok: false, code: 'OFFER_EXPIRED' });
    if (!r.ok) expect(r.message).toContain(fx.milkOffer.validUntil);
  });
});

describe('key loading', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-keys-'));
  const envFile = join(dir, '.env');
  const envVar = 'TEST_SIGNING_KEY_' + process.pid;
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env[envVar];
  });

  it('generates on first run, persists to the env file, reloads the same kid', async () => {
    delete process.env[envVar];
    const k1 = await loadSigningKey({ envFile, envVar });
    const text = readFileSync(envFile, 'utf8');
    expect(text).toContain(`${envVar}='{`);
    expect(text).toContain('"d":');
    expect(process.env[envVar]).toBeTruthy();
    const k2 = await loadSigningKey({ envFile, envVar });
    expect(k2.kid).toBe(k1.kid);
    const signed = await signOffer(fx.breadOffer, k1);
    expect((await verifyOfferJws(signed.jws, jwksFor(k2), { now })).ok).toBe(true);
  });

  it('rejects a malformed key with a clear error', async () => {
    process.env[envVar] = '{"kty":"RSA"}';
    await expect(loadSigningKey({ envFile: null, envVar })).rejects.toThrow(/private EC P-256 JWK/);
    process.env[envVar] = 'nope';
    await expect(loadSigningKey({ envFile: null, envVar })).rejects.toThrow(/not valid JSON/);
  });
});
