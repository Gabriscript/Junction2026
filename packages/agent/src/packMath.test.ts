import { describe, expect, it } from 'vitest';
import type { Product } from '@junction/shared';
import { milkLactoseFree } from '@junction/shared/fixtures';
import { packMath, packSizeOf, orderableLot } from './packMath.js';

describe('packMath', () => {
  it('exact fit shows no overshoot', () => {
    const plan = packMath({ quantity: 1000, unit: 'L' }, 1);
    expect(plan).toMatchObject({ packs: 1000, delivered: 1000, overshoot: 0 });
    expect(plan.note).toBe('1,000 L → 1,000 packs × 1 L');
  });

  it('rounds up and shows the overshoot', () => {
    const plan = packMath({ quantity: 1000, unit: 'L' }, 12, 1, 'cases');
    expect(plan).toMatchObject({ packs: 84, delivered: 1008, overshoot: 8 });
    expect(plan.note).toBe('1,000 L → 84 cases × 12 L = 1,008 L (+8 L)');
  });

  it('respects allowedLotSize above 1', () => {
    // only multiples of 5 packs can be ordered: 84 → 85
    expect(packMath({ quantity: 1000, unit: 'L' }, 12, 5)).toMatchObject({ packs: 85, delivered: 1020, overshoot: 20 });
  });

  it('handles fractional lots without float noise', () => {
    expect(packMath({ quantity: 2.5, unit: 'KG' }, 1, 0.01)).toMatchObject({ packs: 2.5, delivered: 2.5, overshoot: 0 });
    expect(packMath({ quantity: 0.3, unit: 'KG' }, 0.1, 1)).toMatchObject({ packs: 3, overshoot: 0 });
  });

  it('orders crates and bags whole, weight products by fraction', () => {
    const crate = { pack: { salesUnit: 'KI', allowedLotSize: 0.01 } } as never;
    const byKg = { pack: { salesUnit: 'KG', allowedLotSize: 0.01 } } as never;
    expect(orderableLot(crate)).toBe(1);
    expect(orderableLot(byKg)).toBe(0.01);
    expect(packMath({ quantity: 0.5, unit: 'KG' }, 0.78, orderableLot(crate)).packs).toBe(1);
  });

  it('uses the singular for one pack', () => {
    expect(packMath({ quantity: 5, unit: 'L' }, 10).note).toBe('5 L → 1 pack × 10 L = 10 L (+5 L)');
  });

  it('handles large quantities', () => {
    expect(packMath({ quantity: 1_000_000, unit: 'ST' }, 48).packs).toBe(20834);
  });

  it.each([
    [0, 1, 1],
    [-5, 1, 1],
    [10, 0, 1],
    [10, 1, 0],
    [NaN, 1, 1],
  ])('rejects quantity=%s packSize=%s lot=%s', (quantity, packSize, lot) => {
    expect(() => packMath({ quantity, unit: 'L' }, packSize, lot)).toThrow();
  });
});

describe('packSizeOf', () => {
  const withContent = (netContent: Product['pack']['netContent']) => ({ ...milkLactoseFree, pack: { ...milkLactoseFree.pack, netContent } });
  it('reads the net content of one sales unit', () => {
    expect(packSizeOf(milkLactoseFree, 'L')).toBe(12);
  });
  it('scales ML and G to L and KG', () => {
    expect(packSizeOf(withContent({ amount: 500, unit: 'ML' }), 'L')).toBe(0.5);
    expect(packSizeOf(withContent({ amount: 250, unit: 'G' }), 'KG')).toBe(0.25);
  });
  it('is undefined in another unit or when the net content is unknown', () => {
    expect(packSizeOf(milkLactoseFree, 'KG')).toBeUndefined();
    expect(packSizeOf(withContent(null), 'L')).toBeUndefined();
  });
});
