// Pure quantity check, no Node or network imports: the browser UI uses it through history.ts.
import type { StructuredNeed } from './contract.js';

export interface Usual {
  quantity: number;
  unit: StructuredNeed['unit'];
  period: string; // "week", "month"
}

// shortcut: a fixed ratio; a real one would come from the customer's order variance
const UNUSUAL_RATIO = 3;
export const qty = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** For a quantity already judged unusual: what the chef probably meant if one zero slipped (5000 or 50 for 500). */
export function meantQuantity(quantity: number, usual: Usual): number | undefined {
  const typo = quantity >= UNUSUAL_RATIO * usual.quantity ? quantity / 10 : quantity * 10;
  return typo >= usual.quantity / 2 && typo <= usual.quantity * 2 ? typo : undefined;
}

/** A warning when the need is far from the usual order: an extra or missing zero ("5000" or "50" for "500") is the classic slip. */
export function unusualQuantity(need: Pick<StructuredNeed, 'quantity' | 'unit' | 'productQuery'>, usual: Usual | undefined): string | undefined {
  if (!usual || usual.unit !== need.unit) return undefined;
  const high = need.quantity >= UNUSUAL_RATIO * usual.quantity;
  if (!high && need.quantity * UNUSUAL_RATIO > usual.quantity) return undefined;
  const typo = meantQuantity(need.quantity, usual);
  const plausibleTypo = typo !== undefined;
  if (!high && !plausibleTypo) return undefined; // a small top-up is normal: only a missing zero is worth asking about
  const hint = plausibleTypo ? `did you mean ${qty(typo)} ${need.unit}?` : 'please confirm the quantity';
  const difference = `${qty(Math.abs(need.quantity - usual.quantity))} ${need.unit} ${high ? 'more' : 'less'}`;
  return `${qty(need.quantity)} ${need.unit} of ${need.productQuery} is ${difference} than usual (${qty(usual.quantity)} ${need.unit} a ${usual.period}): ${hint}`;
}
