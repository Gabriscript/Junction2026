import { describe, expect, it } from 'vitest';
import * as fx from '@junction/shared/fixtures';
import { isFood, normaliseClaim, parseProductCsv, projectProduct, type RawProduct } from './project.js';
import { ftsQuery, memoryCatalogue } from './store.js';

/** Synthetic raw record in the portal shape (id outside the real range; no dataset content). */
const rawMilk: RawProduct = {
  id: '990101',
  salesUnit: 'KI',
  baseUnit: 'ST',
  salesUnitGtin: '6400000000999',
  category: '90001',
  allowedLotSize: 1,
  deleted: false,
  temperatureCondition: 8,
  vendorName: 'Fixture Dairy Oy',
  countryOfOrigin: 'fi',
  units: [
    { unitId: 'ST', gtin: '6400000000998', sizeInBaseUnits: 1 },
    { unitId: 'KI', sizeInBaseUnits: 10 },
  ],
  substitutions: [{ product: '990101', substituteProduct: '990102' }],
  synkkaData: {
    brand: 'Fixture',
    vatCode: 'MEDIUM',
    variableUnit: false,
    names: [
      { value: 'Fixture lactose free milk drink 1 L', language: 'en' },
      { value: 'Fixture laktoositon maitojuoma 1 L', language: 'fi' },
    ],
    unitConversions: [
      { synkkaPackagingType: 'BASE_UNIT_OR_EACH', volume: { unit: 'MLT', value: 1000 }, netWeight: { unit: 'GRM', value: 1030 } },
    ],
    classifications: [
      { name: 'allergen', values: [{ id: 'AM', unit: 'CONTAINS' }] },
      { name: 'nonAllergen', values: [{ id: 'AN', unit: 'FREE_FROM' }, { id: 'UW', unit: 'FREE_FROM' }] },
      { name: 'nutritionalClaim', values: [{ id: 'FREE_FROM_LACTOSE', unit: 'FREE_FROM' }] },
      { name: 'packagingMarkedLabel', values: [{ id: 'coolTemperature' }, { id: 'GOODS_FROM_FINLAND_BLUE_SWAN' }] },
    ],
  },
};

const rawChemical: RawProduct = {
  id: '990103',
  salesUnit: 'ST',
  baseUnit: 'ST',
  vendorName: 'Fixture Chem',
  synkkaData: {
    vatCode: 'STANDARD',
    names: [{ value: 'Oven rinse 5 l', language: 'en' }],
    safetyData: [{ hazard: 'H315' }],
    classifications: [],
  },
};

describe('projection', () => {
  it('maps a raw milk record to the shared Product shape', () => {
    const p = projectProduct(rawMilk, { deliveryReliability: 0.97, carbonKgCo2ePerKg: null });
    expect(p).not.toBeNull();
    expect(p!.name).toBe('Fixture lactose free milk drink 1 L');
    expect(p!.nameFi).toBe('Fixture laktoositon maitojuoma 1 L');
    expect(p!.originCountry).toBe('FI');
    expect(p!.attributes).toEqual(['LACTOSE_FREE']);
    expect(p!.labels).toEqual(['GOODS_FROM_FINLAND_BLUE_SWAN']);
    expect(p!.allergens).toEqual([
      { code: 'AM', name: 'milk', level: 'CONTAINS' },
      { code: 'AN', name: 'tree nuts', level: 'FREE_FROM' },
      { code: 'UW', name: 'cereals containing gluten', level: 'FREE_FROM' },
    ]);
    expect(p!.pack).toEqual({
      salesUnit: 'KI',
      baseUnit: 'ST',
      baseUnitsPerSalesUnit: 10,
      netContent: { amount: 10, unit: 'L' },
      comparisonUnit: 'L',
      allowedLotSize: 1,
    });
    expect(p!.substitutes).toEqual(['990102']);
    expect(p!.deliveryReliability).toBe(0.97);
    expect(p!.carbonKgCo2ePerKg).toBeNull();
    expect(p!.gtin).toBe('6400000000999');
  });

  it('keeps missing data as null and drops unusable records', () => {
    const p = projectProduct({ id: '990104', salesUnit: 'ST', synkkaData: { names: [{ value: 'NÄYTE', language: 'fi' }] } });
    expect(p).not.toBeNull();
    expect(p!.originCountry).toBeNull();
    expect(p!.pack.netContent).toBeNull();
    expect(p!.allergens).toEqual([]);
    expect(p!.deliveryReliability).toBeNull();
    expect(projectProduct({ id: 'abc' })).toBeNull();
    expect(projectProduct({ id: '990105' })).toBeNull();
  });

  it('food heuristic: reduced VAT = food, chemicals with safety data never', () => {
    expect(isFood(rawMilk)).toBe(true);
    expect(isFood(rawChemical)).toBe(false);
    expect(isFood({ synkkaData: { nutritionalContent: [{ id: 'FAT' }] } })).toBe(true);
    expect(isFood({ synkkaData: { names: [] } })).toBe(false);
  });

  it('normalises claims and parses CSVs defensively', () => {
    expect(normaliseClaim('FREE_FROM_LACTOSE')).toBe('LACTOSE_FREE');
    expect(normaliseClaim('FREE_FROM_GLUTEN')).toBe('GLUTEN_FREE');
    expect(normaliseClaim('NO_ADDED_SUGARS')).toBe('NO_ADDED_SUGAR');
    expect(normaliseClaim('VEGAN')).toBe('VEGAN');
    const m = parseProductCsv('productId,deliveryReliability\n990101,0.97\n990102,abc\n990103,1.5\nbad,1\n', 0, 1);
    expect([...m]).toEqual([['990101', 0.97]]);
  });
});

describe('sqlite catalogue', () => {
  const cat = memoryCatalogue([...fx.products, projectProduct(rawMilk)!]);

  it('FTS "lactose free milk" returns lactose-free milk products only', () => {
    const r = cat.search({ text: 'lactose free milk' });
    const ids = r.products.map((p) => p.id);
    expect(ids).toContain('990001');
    expect(ids).toContain('990002');
    expect(ids).toContain('990101');
    expect(ids).not.toContain('990003');
    expect(r.truncated).toBe(false);
    expect(r.products.every((p) => p.attributes.includes('LACTOSE_FREE'))).toBe(true);
  });

  it('filters by attribute, unit, category and excludes unknown allergen data', () => {
    expect(cat.search({ attributes: ['LACTOSE_FREE'], unit: 'L' }).products.map((p) => p.id).sort()).toEqual(['990001', '990002', '990101']);
    expect(cat.search({ category: '90002' }).products).toHaveLength(2);
    // Free from tree nuts (AN): bread (FREE_FROM) and milk (data present, no AN) pass; muesli MAY_CONTAIN and soup (unknown) fail.
    const ids = cat.search({ freeFromAllergens: ['AN'] }).products.map((p) => p.id);
    expect(ids).toContain('990003');
    expect(ids).toContain('990001');
    expect(ids).not.toContain('990004');
    expect(ids).not.toContain('990005');
  });

  it('truncates and looks products up by id', () => {
    const r = cat.search({ limit: 2 });
    expect(r.products).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect(cat.getById('990003')?.name).toBe('Gluten-free oat bread 500 g');
    expect(cat.getById('000000')).toBeNull();
    expect([...cat.getMany(['990001', '000000']).keys()]).toEqual(['990001']);
    expect(cat.count()).toBe(6);
  });

  it('neutralises FTS syntax in queries', () => {
    expect(ftsQuery('milk OR "drop" NEAR(x)')).toBe('"milk"* AND "or"* AND "drop"* AND "near"* AND "x"*');
    expect(ftsQuery('   ')).toBeNull();
    expect(() => cat.search({ text: 'milk) AND (' })).not.toThrow();
  });
});
