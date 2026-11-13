import { describe, expect, it } from 'vitest';
import { IsoDateTimeSchema, ProductIdSchema, canonicalJson, roundEur, totalsFromNet } from './common.js';

describe('canonicalJson', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}');
  });
  it('is insensitive to key order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});

describe('money helpers', () => {
  it('rounds half-up to cents', () => {
    expect(roundEur(1.005)).toBe(1.01);
    expect(roundEur(64.174999)).toBe(64.17);
  });
  it('computes net/vat/gross', () => {
    expect(totalsFromNet(1209.6, 13.5)).toEqual({ net: 1209.6, vat: 163.3, gross: 1372.9, currency: 'EUR' });
  });
});

describe('primitives', () => {
  it('accepts 6-digit product ids only', () => {
    expect(ProductIdSchema.safeParse('460063').success).toBe(true);
    expect(ProductIdSchema.safeParse('46006').success).toBe(false);
  });
  it('requires an explicit offset on instants', () => {
    expect(IsoDateTimeSchema.safeParse('2026-11-16T00:00:00+02:00').success).toBe(true);
    expect(IsoDateTimeSchema.safeParse('2026-11-16T00:00:00').success).toBe(false);
  });
});
