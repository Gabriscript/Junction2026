/**
 * Catalogue view of a product, as returned by `search_products`.
 *
 * Built by the gateway from the portal product JSON (+ reliability and carbon CSVs).
 * It is a *projection*: only what an agent needs to shortlist. No prices or stock
 * here — those come from `get_offers` and are signed.
 */
import { z } from 'zod';
import {
  ComparisonUnitSchema,
  CountryCodeSchema,
  ProductIdSchema,
  UnitCodeSchema,
} from './common.js';

/**
 * Relation between a product and an allergen, from the catalogue classifications:
 * - `CONTAINS`     — declared ingredient (classification group `allergen`, unit CONTAINS)
 * - `MAY_CONTAIN`  — cross-contamination risk (group `allergen`, unit MAY_CONTAIN)
 * - `FREE_FROM`    — explicit free-from declaration (group `nonAllergen`)
 * A product with *no entry* for a code has UNKNOWN status. Policy treats unknown as unsafe.
 */
export const AllergenLevelSchema = z
  .enum(['CONTAINS', 'MAY_CONTAIN', 'FREE_FROM'])
  .describe('CONTAINS | MAY_CONTAIN | FREE_FROM');
export type AllergenLevel = z.infer<typeof AllergenLevelSchema>;

/**
 * GS1 AllergenTypeCode → English name, best effort. The dataset ships codes only.
 * Codes missing here are shown verbatim (never guessed). Extend when the loader meets new codes.
 */
export const GS1_ALLERGEN_NAMES: Readonly<Record<string, string>> = {
  AC: 'crustaceans',
  AE: 'eggs',
  AF: 'fish',
  AM: 'milk',
  AN: 'tree nuts',
  AP: 'peanuts',
  AS: 'sesame seeds',
  AU: 'sulphur dioxide and sulphites',
  AW: 'wheat (gluten)',
  AY: 'soybeans',
  BC: 'celery',
  BM: 'mustard',
  NL: 'lupin',
  UM: 'molluscs',
  UW: 'cereals containing gluten',
  GB: 'barley',
  GO: 'oats',
  GS: 'spelt',
  NR: 'rye',
  SA: 'almonds',
  SC: 'cashew nuts',
  SH: 'hazelnuts',
  SM: 'macadamia nuts',
  SP: 'pistachio nuts',
  SR: 'brazil nuts',
  SW: 'walnuts',
};

export const ProductAllergenSchema = z
  .object({
    /** GS1 AllergenTypeCode, e.g. `AM` (milk), `AW` (wheat), `UW` (gluten cereals). */
    code: z.string().min(1).max(8).describe('GS1 allergen code, e.g. AM = milk'),
    /** English name when known (see `GS1_ALLERGEN_NAMES`); omitted when the code is unmapped. */
    name: z.string().min(1).optional().describe('Allergen name if known'),
    /** Relation of the product to this allergen. */
    level: AllergenLevelSchema,
  })
  .describe('Allergen declaration of a product');
export type ProductAllergen = z.infer<typeof ProductAllergenSchema>;

/** Net content of ONE sales unit, e.g. a crate of 10 × 1 L milk → `{ amount: 10, unit: 'L' }`. */
export const NetContentSchema = z
  .object({
    /** Quantity in `unit`, > 0. */
    amount: z.number().positive().describe('Net content amount per sales unit'),
    /** Measurement unit of `amount`: `L`, `KG`, `G`, `ML`, `ST` (pieces). */
    unit: z.enum(['L', 'ML', 'KG', 'G', 'ST']).describe('L | ML | KG | G | ST'),
  })
  .describe('Net content of one sales unit');
export type NetContent = z.infer<typeof NetContentSchema>;

/** Packaging information needed for unit/pack math (litres → crates etc.). */
export const PackInfoSchema = z
  .object({
    /** Unit the product is ordered in (Aimo `salesUnit`), e.g. `KI`. */
    salesUnit: UnitCodeSchema.describe('Order unit (Aimo salesUnit)'),
    /** Smallest unit in Aimo's packaging hierarchy (`baseUnit`), e.g. `ST` or `KG`. */
    baseUnit: UnitCodeSchema.describe('Aimo baseUnit'),
    /** How many base units one sales unit holds (`units[].sizeInBaseUnits` for the sales unit). `null` when unknown. */
    baseUnitsPerSalesUnit: z
      .number()
      .positive()
      .nullable()
      .describe('Base units per sales unit; null = unknown'),
    /** Net content of one sales unit in L/KG/…; `null` when the catalogue has no conversion data. */
    netContent: NetContentSchema.nullable().describe('Net content per sales unit; null = unknown'),
    /** Unit of the comparison price (per L or per KG). `null` for non-food / unknown. */
    comparisonUnit: ComparisonUnitSchema.nullable().describe('Comparison unit; null = none'),
    /** Minimum order increment in sales units (Aimo `allowedLotSize`), e.g. 1 or 0.01 for variable weight. */
    allowedLotSize: z.number().positive().describe('Order increment in sales units'),
  })
  .describe('Packaging / unit information');
export type PackInfo = z.infer<typeof PackInfoSchema>;

export const ProductSchema = z
  .object({
    /** Aimo product code (6 digits). */
    id: ProductIdSchema,
    /** Display name, English if available, otherwise Finnish. */
    name: z.string().min(1).describe('Product name (en preferred)'),
    /** Finnish name when different from `name`. */
    nameFi: z.string().min(1).optional().describe('Finnish name'),
    /** Brand (`synkkaData.brand`); missing for ~18 % of products. */
    brand: z.string().min(1).optional().describe('Brand'),
    /** Supplier / vendor name (`vendorName`), e.g. "Valio Oy Tuore". */
    supplier: z.string().min(1).describe('Vendor name'),
    /** Aimo category code (numeric string, 349 distinct). Names are NOT provided by the dataset. */
    category: z.string().min(1).describe('Aimo category code (no names available)'),
    /** ISO alpha-2 country of origin, upper-case; `null` when missing. */
    originCountry: CountryCodeSchema.nullable().describe('Country of origin; null = unknown'),
    /**
     * Certification / sustainability labels from `packagingMarkedLabel`, verbatim codes, e.g.
     * `EU_ORGANIC_FARMING`, `GOODS_FROM_FINLAND_BLUE_SWAN`, `FAIR_TRADE_MARK`, `SVANEN`.
     */
    labels: z.array(z.string().min(1)).describe('Certification/sustainability label codes'),
    /**
     * Normalised dietary attributes derived from `nutritionalClaim`, e.g. `LACTOSE_FREE`,
     * `GLUTEN_FREE`, `VEGAN`, `VEGETARIAN`, `NO_ADDED_SUGAR`, `HIGH_PROTEIN`, `LOW_SALT`.
     * These are what `search_products.attributes` matches against.
     */
    attributes: z.array(z.string().min(1)).describe('Dietary attribute codes, e.g. LACTOSE_FREE'),
    /** Allergen declarations. Absence of a code = unknown (treated as unsafe by policy). */
    allergens: z.array(ProductAllergenSchema).describe('Allergen declarations'),
    /** Packaging and unit information. */
    pack: PackInfoSchema,
    /** Aimo-listed substitute product ids (`substitutions[].substituteProduct`). Empty for ~99 % of products. */
    substitutes: z.array(ProductIdSchema).describe('Aimo-listed substitute product ids'),
    /** Delivery reliability ratio in [0, 1] from the CSV (25 % coverage); `null` = unknown, never invented. */
    deliveryReliability: z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .describe('Delivery reliability 0..1; null = unknown'),
    /** Average kg CO₂e per kg of product from the CSV (63 % coverage); `null` = unknown, never invented. */
    carbonKgCo2ePerKg: z
      .number()
      .nonnegative()
      .nullable()
      .describe('kg CO2e per kg; null = unknown'),
    /** Storage temperature condition code 1–9 (meanings not provided by the dataset). */
    temperatureCondition: z.number().int().min(1).max(9).nullable().optional(),
    /** GTIN of the sales unit when present. */
    gtin: z.string().min(8).max(14).optional().describe('GTIN of the sales unit'),
  })
  .describe('Catalogue product (no price/stock; see Offer)');
export type Product = z.infer<typeof ProductSchema>;
