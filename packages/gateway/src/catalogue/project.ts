/**
 * Projection: raw portal product JSON → shared `Product`.
 *
 * Data files are untrusted input: everything is read defensively, nothing is executed.
 * Missing values stay `null`/absent — never invented (common.ts conventions).
 */
import { ProductSchema, type Product, type ProductAllergen } from '@junction/shared';
import { allergenName } from './allergens.js';

/** Loose shape of one raw product. Only the fields we read are typed. */
export interface RawProduct {
  id?: unknown;
  salesUnit?: unknown;
  baseUnit?: unknown;
  salesUnitGtin?: unknown;
  category?: unknown;
  allowedLotSize?: unknown;
  deleted?: unknown;
  temperatureCondition?: unknown;
  vendorName?: unknown;
  countryOfOrigin?: unknown;
  units?: unknown;
  substitutions?: unknown;
  synkkaData?: {
    brand?: unknown;
    vatCode?: unknown;
    variableUnit?: unknown;
    names?: unknown;
    classifications?: unknown;
    unitConversions?: unknown;
    nutritionalContent?: unknown;
    safetyData?: unknown;
    keyIngredients?: unknown;
    ingredients?: unknown;
  };
}

interface ClassValue {
  id?: unknown;
  synkkaId?: unknown;
  unit?: unknown;
}
interface Classification {
  name?: unknown;
  values?: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const TEMPERATURE_MARKERS = new Set(['coolTemperature', 'warmTemperature', 'freezeTemperature']);

/**
 * Food heuristic (the dataset has no category names):
 *  - chemicals with safety data are never food;
 *  - Finnish reduced ("MEDIUM") VAT code = food; STANDARD = non-food;
 *  - otherwise food only if it carries nutrition or allergen/claim data.
 */
export function isFood(raw: RawProduct): boolean {
  const s = raw.synkkaData ?? {};
  if (arr(s.safetyData).length > 0) return false;
  const vat = str(s.vatCode) ?? '';
  if (vat.includes('MEDIUM') || vat === 'LOW') return true;
  if (vat === 'STANDARD' || vat === 'NOT_APPLICABLE') return false;
  if (arr(s.nutritionalContent).length > 0) return true;
  return classifications(raw).some(
    (c) => ['allergen', 'nonAllergen', 'nutritionalClaim', 'nutritionFact'].includes(String(c.name)) && arr(c.values).length > 0,
  );
}

function classifications(raw: RawProduct): Classification[] {
  return arr<Classification>(raw.synkkaData?.classifications).filter((c) => c && typeof c === 'object');
}

function classValues(raw: RawProduct, name: string): ClassValue[] {
  return classifications(raw)
    .filter((c) => c.name === name)
    .flatMap((c) => arr<ClassValue>(c.values))
    .filter((v) => v && typeof v === 'object');
}

/** `FREE_FROM_LACTOSE` → `LACTOSE_FREE`, `NO_ADDED_SUGARS` → `NO_ADDED_SUGAR`, `LOW_SODIUM_SALT` → `LOW_SALT`. */
export function normaliseClaim(id: string): string {
  const special: Record<string, string> = {
    NO_ADDED_SUGARS: 'NO_ADDED_SUGAR',
    LOW_SODIUM_SALT: 'LOW_SALT',
    FREE_FROM_SODIUM_SALT: 'SALT_FREE',
    FREE_FROM_COLOURING_AGENTS: 'COLOURING_FREE',
    FREE_FROM_ARTIFICIAL_SWEETENERS: 'ARTIFICIAL_SWEETENER_FREE',
  };
  if (special[id]) return special[id];
  const m = /^FREE_FROM_(.+)$/.exec(id);
  if (m) return `${m[1]!.replace(/S$/, '')}_FREE`;
  return id;
}

function pickName(raw: RawProduct, lang: string): string | undefined {
  const n = arr<{ value?: unknown; language?: unknown }>(raw.synkkaData?.names).find((x) => x?.language === lang);
  return str(n?.value);
}

/** Net content of ONE base unit, normalised to L / KG / ST. */
function baseNetContent(raw: RawProduct): { amount: number; unit: 'L' | 'KG' | 'ST' } | null {
  const conv = arr<Record<string, { unit?: unknown; value?: unknown } | undefined>>(raw.synkkaData?.unitConversions);
  const base = conv.find((u) => u?.synkkaPackagingType === ('BASE_UNIT_OR_EACH' as unknown)) ?? conv[0];
  if (!base) return null;
  const measure = (m: { unit?: unknown; value?: unknown } | undefined) => {
    const value = num(m?.value);
    const unit = str(m?.unit);
    if (!value || value <= 0 || !unit) return null;
    switch (unit) {
      case 'LTR':
        return { amount: value, unit: 'L' as const };
      case 'MLT':
        return { amount: value / 1000, unit: 'L' as const };
      case 'CLT':
        return { amount: value / 100, unit: 'L' as const };
      case 'KGM':
        return { amount: value, unit: 'KG' as const };
      case 'GRM':
        return { amount: value / 1000, unit: 'KG' as const };
      case 'H87':
        return { amount: value, unit: 'ST' as const };
      default:
        return null;
    }
  };
  return measure(base.volume) ?? measure(base.netWeight) ?? null;
}

function round(n: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export interface ProjectionExtras {
  deliveryReliability?: number | null;
  carbonKgCo2ePerKg?: number | null;
}

/**
 * Project one raw product. Returns `null` when the record is unusable (bad id, no name).
 * Reliability and carbon come from the CSV joins; missing = null.
 */
export function projectProduct(raw: RawProduct, extras: ProjectionExtras = {}): Product | null {
  const id = str(raw.id);
  if (!id || !/^\d{6}$/.test(id)) return null;
  const nameEn = pickName(raw, 'en');
  const nameFi = pickName(raw, 'fi');
  const name = nameEn ?? nameFi ?? pickName(raw, 'sv');
  if (!name) return null;

  const salesUnit = str(raw.salesUnit) ?? 'ST';
  const baseUnit = str(raw.baseUnit) ?? salesUnit;
  const units = arr<{ unitId?: unknown; sizeInBaseUnits?: unknown }>(raw.units);
  const salesUnitEntry = units.find((u) => u?.unitId === salesUnit);
  const baseUnitsPerSalesUnit =
    salesUnit === baseUnit ? 1 : (num(salesUnitEntry?.sizeInBaseUnits) ?? null);

  const variable = raw.synkkaData?.variableUnit === true || salesUnit === 'KG';
  let netContent: Product['pack']['netContent'] = null;
  if (variable && salesUnit === 'KG') {
    netContent = { amount: 1, unit: 'KG' };
  } else {
    const base = baseNetContent(raw);
    if (base && baseUnitsPerSalesUnit) netContent = { amount: round(base.amount * baseUnitsPerSalesUnit), unit: base.unit };
  }
  const comparisonUnit = netContent?.unit === 'L' ? 'L' : netContent?.unit === 'KG' ? 'KG' : null;

  const allergens: ProductAllergen[] = [];
  const seen = new Set<string>();
  const pushAllergen = (code: string | undefined, level: ProductAllergen['level']) => {
    if (!code || code.length > 8) return;
    const key = `${code}:${level}`;
    if (seen.has(key)) return;
    seen.add(key);
    const n = allergenName(code);
    allergens.push(n ? { code, name: n, level } : { code, level });
  };
  for (const v of classValues(raw, 'allergen')) {
    const level = v.unit === 'MAY_CONTAIN' ? 'MAY_CONTAIN' : v.unit === 'CONTAINS' ? 'CONTAINS' : null;
    if (level) pushAllergen(str(v.id) ?? str(v.synkkaId), level);
  }
  for (const v of classValues(raw, 'nonAllergen')) {
    if (v.unit === 'FREE_FROM') pushAllergen(str(v.id) ?? str(v.synkkaId), 'FREE_FROM');
  }

  const attributes = [
    ...new Set(
      classValues(raw, 'nutritionalClaim')
        .map((v) => str(v.id))
        .filter((x): x is string => !!x)
        .map(normaliseClaim),
    ),
  ].sort();

  const labels = [
    ...new Set(
      classValues(raw, 'packagingMarkedLabel')
        .map((v) => str(v.id))
        .filter((x): x is string => !!x && !TEMPERATURE_MARKERS.has(x)),
    ),
  ].sort();

  const country = str(raw.countryOfOrigin)?.toUpperCase();
  const temp = num(raw.temperatureCondition);
  const gtin = str(raw.salesUnitGtin);
  const brand = str(raw.synkkaData?.brand);

  const product: Product = {
    id,
    name,
    ...(nameFi && nameFi !== name ? { nameFi } : {}),
    ...(brand ? { brand } : {}),
    supplier: str(raw.vendorName) ?? 'unknown vendor',
    category: str(raw.category) ?? 'unknown',
    originCountry: country && /^[A-Z]{2}$/.test(country) ? country : null,
    labels,
    attributes,
    allergens,
    pack: {
      salesUnit,
      baseUnit,
      baseUnitsPerSalesUnit,
      netContent,
      comparisonUnit,
      allowedLotSize: num(raw.allowedLotSize) && num(raw.allowedLotSize)! > 0 ? num(raw.allowedLotSize)! : 1,
    },
    substitutes: [
      ...new Set(
        arr<{ substituteProduct?: unknown }>(raw.substitutions)
          .map((s) => str(s?.substituteProduct))
          .filter((x): x is string => !!x && /^\d{6}$/.test(x) && x !== id),
      ),
    ],
    deliveryReliability: extras.deliveryReliability ?? null,
    carbonKgCo2ePerKg: extras.carbonKgCo2ePerKg ?? null,
    temperatureCondition: temp && temp >= 1 && temp <= 9 && Number.isInteger(temp) ? temp : null,
    ...(gtin && gtin.length >= 8 && gtin.length <= 14 ? { gtin } : {}),
  };

  const parsed = ProductSchema.safeParse(product);
  return parsed.success ? parsed.data : null;
}

/** Parse a two-column CSV (`productId,value`) into a map. Non-numeric / out-of-range rows are skipped. */
export function parseProductCsv(text: string, min = -Infinity, max = Infinity): Map<string, number> {
  const out = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const [idRaw, valueRaw] = line.split(',');
    const id = idRaw?.trim();
    const value = Number(valueRaw?.trim());
    if (!id || !/^\d{6}$/.test(id) || !Number.isFinite(value) || value < min || value > max) continue;
    out.set(id, value);
  }
  return out;
}
