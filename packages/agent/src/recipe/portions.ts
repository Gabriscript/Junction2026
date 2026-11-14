/**
 * Per-serving sanity bounds. If a suggester (LLM) proposes 900 g of pasta per
 * person, the code clamps it and writes the correction into the assumptions.
 * Values are rough professional-kitchen portions; they are bounds, not targets.
 */
import type { IngredientKind, PortionUnit } from './types.js';

type Bounds = { min: number; max: number };

const G_BOUNDS: Record<IngredientKind, Bounds> = {
  pasta_rice_grain: { min: 60, max: 150 },
  sauce: { min: 20, max: 150 },
  cheese: { min: 5, max: 80 },
  protein: { min: 60, max: 300 },
  vegetable: { min: 20, max: 300 },
  fruit: { min: 30, max: 250 },
  dairy_liquid: { min: 20, max: 400 },
  fat_oil: { min: 2, max: 30 },
  herb_spice: { min: 0.5, max: 15 },
  bread_bakery: { min: 30, max: 150 },
  other: { min: 1, max: 400 },
};

const PCS_BOUNDS: Bounds = { min: 0.1, max: 6 };

export function portionBounds(kind: IngredientKind, unit: PortionUnit): Bounds {
  if (unit === 'pcs') return PCS_BOUNDS;
  // g and ml treated alike (density ≈ 1 is good enough for bounds)
  return G_BOUNDS[kind] ?? G_BOUNDS.other;
}

export function clampPortion(
  kind: IngredientKind,
  unit: PortionUnit,
  perServing: number,
): { value: number; clamped: boolean } {
  const { min, max } = portionBounds(kind, unit);
  if (perServing < min) return { value: min, clamped: true };
  if (perServing > max) return { value: max, clamped: true };
  return { value: perServing, clamped: false };
}

/** Converts a total in g/ml/pcs to the catalogue unit (KG / L / ST), rounded to 3 decimals. */
export function toCatalogueUnit(
  unit: PortionUnit,
  total: number,
): { unit: 'KG' | 'L' | 'ST'; quantity: number } {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  if (unit === 'g') return { unit: 'KG', quantity: r(total / 1000) };
  if (unit === 'ml') return { unit: 'L', quantity: r(total / 1000) };
  return { unit: 'ST', quantity: Math.ceil(total) };
}
