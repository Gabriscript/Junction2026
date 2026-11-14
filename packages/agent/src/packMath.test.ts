import { describe, expect, it } from 'vitest';
import { packMath, packSizeOf } from './packMath.js';

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

  it('uses the singular for one pack', () => {
    expect(packMath({ quantity: 5, unit: 'L' }, 10).note).toBe('5 L → 1 pack × 10 L = 10 L (+5 L)');
  });

  it('handles large quantities', () => {
    expect(packMath({ quantity: 1_000_000, unit: 'PCS' }, 48).packs).toBe(20834);
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
  const base = { id: 'p', name: 'p', baseUnit: 'L', attributes: [], allergens: [] };
  it('reads the size of the sales unit', () => {
    const units = [{ unitId: 'ST', sizeInBaseUnits: 1 }, { unitId: 'KI', sizeInBaseUnits: 12 }];
    expect(packSizeOf({ ...base, salesUnit: 'KI', units })).toBe(12);
  });
  it('is 1 when the sales unit is the base unit and not listed', () => {
    expect(packSizeOf({ ...base, salesUnit: 'L', units: [] })).toBe(1);
  });
  it('is undefined when the pack size is unknown', () => {
    expect(packSizeOf({ ...base, salesUnit: 'KI', units: [] })).toBeUndefined();
  });
});
