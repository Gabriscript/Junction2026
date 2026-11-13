import type { Product, Unit } from './contract.js';

export interface PackPlan {
  packs: number; // sales units to order
  packSize: number; // base units per sales unit
  delivered: number; // packs × packSize, in the need's unit
  overshoot: number; // delivered − requested
  note: string;
}

const round = (value: number) => Math.round(value * 1e4) / 1e4;
const fmt = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Packs to order for a need, rounded up to the allowed lot size, with a human-readable note. */
export function packMath(
  need: { quantity: number; unit: Unit },
  packSize: number,
  allowedLotSize = 1,
  packLabel = 'packs',
): PackPlan {
  // product data comes from the gateway: reject values that would give Infinity or NaN packs
  for (const [name, value] of Object.entries({ quantity: need.quantity, packSize, allowedLotSize })) {
    if (!(Number.isFinite(value) && value > 0)) throw new Error(`packMath: ${name} must be a positive number, got ${value}`);
  }
  // the epsilon stops float noise (0.3 / 0.1 = 2.9999…) from adding a whole extra lot
  const packs = round(Math.ceil(need.quantity / packSize / allowedLotSize - 1e-9) * allowedLotSize);
  const delivered = round(packs * packSize);
  const overshoot = round(delivered - need.quantity);
  const label = packs === 1 ? packLabel.replace(/s$/, '') : packLabel;
  const note =
    `${fmt(need.quantity)} ${need.unit} → ${fmt(packs)} ${label} × ${fmt(packSize)} ${need.unit}` +
    (overshoot > 0 ? ` = ${fmt(delivered)} ${need.unit} (+${fmt(overshoot)} ${need.unit})` : '');
  return { packs, packSize, delivered, overshoot, note };
}

/** Base units in one sales unit, or undefined when the product data does not say. */
export function packSizeOf(product: Product): number | undefined {
  const size = product.units.find((unit) => unit.unitId === product.salesUnit)?.sizeInBaseUnits;
  return size ?? (product.salesUnit === product.baseUnit ? 1 : undefined);
}
