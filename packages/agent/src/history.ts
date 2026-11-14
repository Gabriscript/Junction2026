/**
 * Pre-send review of a week of orders, the way a kitchen uses par levels: what we usually order,
 * how often, and what the menu needs. The dataset has no order history, so the demo history is
 * synthetic (seeded, reproducible) and says so.
 */
import { unusualQuantity, type Usual } from './agent.js';
import type { Unit } from './contract.js';

export interface WeekOrder {
  item: string; // product words, as the need parser gives them ("milk")
  quantity: number;
  unit: Unit;
}
export interface PastWeek {
  week: string; // Monday, YYYY-MM-DD
  orders: WeekOrder[];
}
export interface Dish {
  name: string;
  ingredients: string[];
}
export interface Finding {
  kind: 'quantity' | 'missing' | 'menu';
  item: string;
  message: string;
}

/** Par level of one item: robust usual quantity (median), how often it is ordered, and when it last was. */
export interface Par {
  unit: Unit;
  median: number;
  every: number; // weeks between orders, rounded
  count: number;
  weeksSince: number; // weeks between the last order and the week under review
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
// usual amounts are estimates: whole units from 10 up, two decimals below (never rounded down to 0)
const nice = (value: number) => (value >= 10 ? Math.round(value) : Math.round(value * 100) / 100 || value);
const fmt = (value: number) => nice(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
/** One spelling per item: "Würstel " and "wurstel" are the same thing. */
const key = (item: string) => item.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
// below this many orders an item has no reliable rhythm: never flag it as missing
const MIN_ORDERS = 3;
// an item not ordered for this many of its rhythms was dropped from the menu, not forgotten
const DROPPED_AFTER = 3;

export function parLevels(history: PastWeek[]): Map<string, Par> {
  const pars = new Map<string, Par>();
  const items = new Set(history.flatMap((week) => week.orders.map((order) => key(order.item))));
  for (const item of items) {
    const weeks = history.flatMap((week, index) => week.orders.filter((o) => key(o.item) === item).map((o) => ({ index, order: o })));
    const first = weeks[0]!;
    const last = weeks.at(-1)!;
    const unit = first.order.unit;
    pars.set(item, {
      unit,
      median: median(weeks.filter((w) => w.order.unit === unit).map((w) => w.order.quantity)), // never mix units
      every: Math.max(1, Math.round((history.length - first.index) / weeks.length)),
      count: weeks.length,
      weeksSince: history.length - last.index,
    });
  }
  return pars;
}

/** Usual sizes for runAgent's single-request check, from the same history. */
export const usualFromHistory = (history: PastWeek[]): Record<string, Usual> =>
  Object.fromEntries([...parLevels(history)].map(([item, par]) => [item, { quantity: nice(par.median), unit: par.unit, period: par.every === 1 ? 'week' : `${par.every} weeks` }]));

/**
 * Questions for the chef before the week's orders go out: a quantity far from the usual one or in
 * another unit, a regular item that is due but not ordered, a menu ingredient never ordered.
 * One finding per item; several lines of the same item and unit count as one.
 */
export function reviewWeek(history: PastWeek[], menu: Dish[], thisWeek: WeekOrder[]): Finding[] {
  const pars = parLevels(history);
  const usual = usualFromHistory(history);
  const lines = new Map<string, WeekOrder>();
  for (const order of thisWeek) {
    const id = `${key(order.item)}|${order.unit}`;
    const seen = lines.get(id);
    lines.set(id, { item: key(order.item), unit: order.unit, quantity: (seen?.quantity ?? 0) + order.quantity });
  }
  const ordered = new Set([...lines.values()].map((order) => order.item));
  const dishesUsing = (item: string) => menu.filter((dish) => dish.ingredients.map(key).includes(item)).map((dish) => dish.name);
  const findings: Finding[] = [];

  for (const order of lines.values()) {
    const par = pars.get(order.item);
    const warning =
      par && par.unit !== order.unit
        ? `${fmt(order.quantity)} ${order.unit} of ${order.item}: usually ordered in ${par.unit} (about ${fmt(par.median)} ${par.unit}), please check the unit`
        : unusualQuantity({ quantity: order.quantity, unit: order.unit, productQuery: order.item }, usual[order.item]);
    if (warning) findings.push({ kind: 'quantity', item: order.item, message: warning });
  }
  for (const [item, par] of pars) {
    if (ordered.has(item) || par.count < MIN_ORDERS || par.weeksSince < par.every || par.weeksSince > DROPPED_AFTER * par.every) continue;
    const dishes = dishesUsing(item);
    const rhythm = par.every === 1 ? 'every week' : `every ${par.every} weeks`;
    findings.push({
      kind: 'missing',
      item,
      message: `you usually order ${item} ${rhythm} (about ${fmt(par.median)} ${par.unit}${dishes.length ? `, used in ${dishes.join(', ')}` : ''}), not in this week's orders: forgotten?`,
    });
  }
  const needed = [...new Set(menu.flatMap((dish) => dish.ingredients.map(key)))];
  for (const item of needed) {
    if (ordered.has(item) || pars.has(item)) continue; // known items are judged by their rhythm above
    findings.push({ kind: 'menu', item, message: `${dishesUsing(item).join(', ')} needs ${item}: never ordered before and not in this week's orders` });
  }
  return findings;
}

// ---- synthetic demo data (seeded, reproducible) ----

/** Small seeded PRNG (mulberry32): the same seed always gives the same history. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hotel Aurora's kitchen: par quantity per order, unit, and every how many weeks it is ordered. */
export const DEMO_PARS: { item: string; quantity: number; unit: Unit; every: number }[] = [
  { item: 'milk', quantity: 500, unit: 'L', every: 1 },
  { item: 'mozzarella', quantity: 40, unit: 'KG', every: 1 },
  { item: 'tomatoes', quantity: 30, unit: 'KG', every: 1 },
  { item: 'fries', quantity: 50, unit: 'KG', every: 1 },
  { item: 'basil', quantity: 1, unit: 'KG', every: 1 },
  { item: 'flour', quantity: 100, unit: 'KG', every: 2 },
  { item: 'olive oil', quantity: 20, unit: 'L', every: 2 },
  { item: 'salt', quantity: 10, unit: 'KG', every: 4 },
];

/** Pizza tedesca is new on the menu: würstel has never been ordered. */
export const DEMO_MENU: Dish[] = [
  { name: 'pizza margherita', ingredients: ['flour', 'tomatoes', 'mozzarella', 'basil', 'olive oil', 'salt'] },
  { name: 'pizza tedesca', ingredients: ['flour', 'tomatoes', 'mozzarella', 'wurstel', 'fries'] },
];

const addWeeks = (monday: string, weeks: number) => new Date(Date.parse(`${monday}T00:00:00Z`) + weeks * 7 * 86_400_000).toISOString().slice(0, 10);

/** `weeks` weeks of orders ending the week before `nextMonday`, quantities within ±15 % of par. */
export function syntheticHistory(seed: number, weeks: number, nextMonday: string, pars = DEMO_PARS): PastWeek[] {
  const rand = random(seed);
  return Array.from({ length: weeks }, (_, index) => ({
    week: addWeeks(nextMonday, index - weeks),
    orders: pars
      .filter((par) => (weeks - index) % par.every === 0 || par.every === 1)
      .map((par) => ({ item: par.item, unit: par.unit, quantity: Math.round(par.quantity * (0.85 + 0.3 * rand()) * 100) / 100 })),
  }));
}

/** The week a regular kitchen would order next, straight from the pars (what "nothing forgotten" looks like). */
export function expectedWeek(history: PastWeek[], pars = DEMO_PARS): WeekOrder[] {
  const levels = parLevels(history);
  return pars.filter((par) => (levels.get(par.item)?.weeksSince ?? Infinity) >= par.every).map(({ item, quantity, unit }) => ({ item, quantity, unit }));
}
