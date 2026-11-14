import { describe, expect, it } from 'vitest';
import { DEMO_MENU, expectedWeek, parLevels, reviewWeek, syntheticHistory, type WeekOrder } from './history.js';

const MARGHERITA = DEMO_MENU.filter((dish) => dish.name === 'pizza margherita');
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * Outside judge: 20 seeded histories, the last 4 weeks held out. The past weeks get 10 % random
 * legitimate skips (a kitchen does not order like clockwork), so rhythms must be estimated, not
 * read back. Each held-out week is reviewed as it was (no alarm wanted), then with one planted slip
 * at a time. Slips of ×10 / ÷10 and dropped items must be caught; ×2 is deliberately not flagged
 * (normal busy-week variation) and the test pins that limit.
 */
const lcg = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
describe('reviewWeek against planted slips on held-out weeks', () => {
  const runs = SEEDS.flatMap((seed) => {
    const history = syntheticHistory(seed, 16, '2026-11-16');
    const skip = lcg(seed * 7919);
    const past = history.slice(0, 12).map((week) => ({ ...week, orders: week.orders.filter(() => skip() >= 0.1) }));
    return [12, 13, 14, 15].map((i) => ({ past: [...past, ...history.slice(12, i)], week: history[i]!.orders }));
  });

  it('raises no false alarm on the real held-out weeks', () => {
    expect(runs.flatMap(({ past, week }) => reviewWeek(past, MARGHERITA, week))).toEqual([]);
  });

  it('catches dropped items and missing or extra zeros, and stays quiet at ×2', () => {
    const tally: Record<string, { planted: number; caught: number }> = {};
    let extra = 0;
    for (const { past, week } of runs) {
      for (const order of week) {
        const slips: [string, WeekOrder[], 'missing' | 'quantity'][] = [
          ['drop', week.filter((o) => o !== order), 'missing'],
          ['x10', week.map((o) => (o === order ? { ...o, quantity: o.quantity * 10 } : o)), 'quantity'],
          ['/10', week.map((o) => (o === order ? { ...o, quantity: o.quantity / 10 } : o)), 'quantity'],
          ['x2', week.map((o) => (o === order ? { ...o, quantity: o.quantity * 2 } : o)), 'quantity'],
        ];
        for (const [name, slipped, kind] of slips) {
          const t = (tally[name] ??= { planted: 0, caught: 0 });
          t.planted++;
          const findings = reviewWeek(past, MARGHERITA, slipped);
          if (findings.some((f) => f.item === order.item && f.kind === kind)) t.caught++;
          extra += findings.filter((f) => f.item !== order.item).length;
        }
      }
    }
    const recall = (name: string) => tally[name]!.caught / tally[name]!.planted;
    expect(tally['drop']!.planted).toBeGreaterThan(400);
    expect(recall('drop')).toBeGreaterThanOrEqual(0.95); // a skip right before the held-out week can hide a rhythm
    expect(recall('x10')).toBe(1);
    expect(recall('/10')).toBe(1);
    expect(recall('x2')).toBe(0); // documented limit: below ×3 is not flagged
    expect(extra).toBe(0);
  });
});

describe('reviewWeek edge cases', () => {
  const week = (item: string, quantity: number, unit: WeekOrder['unit'] = 'KG'): WeekOrder => ({ item, quantity, unit });
  const weekly = (n: number, orders: WeekOrder[]) => Array.from({ length: n }, (_, i) => ({ week: `w${i}`, orders }));

  it('does not call an item dropped from the menu long ago forgotten', () => {
    const history = [...weekly(6, [week('pumpkin', 5), week('salt', 1)]), ...weekly(7, [week('salt', 1)])];
    expect(reviewWeek(history, [], [week('salt', 1)])).toEqual([]);
  });

  it('flags another unit, sums duplicate lines, and ignores spelling differences', () => {
    const history = weekly(6, [week('milk', 500, 'L'), week('Würstel', 10)]);
    expect(reviewWeek(history, [{ name: 'pizza tedesca', ingredients: ['wurstel'] }], [week('milk', 500, 'KG'), week('wurstel', 5), week('wurstel', 5)]).map((f) => f.message)).toEqual([
      '500 KG of milk: usually ordered in L (about 500 L), please check the unit',
    ]);
  });

  it('lets a small top-up through but asks about a missing zero', () => {
    const history = weekly(6, [week('salt', 10), week('milk', 500, 'L')]);
    expect(reviewWeek(history, [], [week('salt', 3), week('milk', 50, 'L')]).map((f) => f.item)).toEqual(['milk']);
  });
});

describe('demo week', () => {
  const history = syntheticHistory(7, 12, '2026-11-16');

  it('computes robust par levels from the history', () => {
    const milk = parLevels(history).get('milk')!;
    expect(milk).toMatchObject({ unit: 'L', every: 1, count: 12, weeksSince: 1 });
    expect(milk.median).toBeGreaterThan(425);
    expect(milk.median).toBeLessThan(575);
    expect(parLevels(history).get('salt')).toMatchObject({ every: 4, count: 3 });
  });

  it('asks about the typo, the forgotten basil and the new dish ingredient, once each', () => {
    const week = expectedWeek(history)
      .filter((o) => o.item !== 'basil')
      .map((o) => (o.item === 'milk' ? { ...o, quantity: 5000 } : o));
    const findings = reviewWeek(history, DEMO_MENU, week);
    expect(findings.map((f) => [f.kind, f.item])).toEqual([
      ['quantity', 'milk'],
      ['missing', 'basil'],
      ['menu', 'wurstel'],
    ]);
    expect(findings[0]?.message).toMatch(/^5,000 L of milk is .* more than usual \(.* L a week\): did you mean 500 L\?$/);
    expect(findings[1]?.message).toContain('used in pizza margherita');
    expect(findings[2]?.message).toBe('pizza tedesca needs wurstel: never ordered before and not in this week\'s orders');
    // the answer the UI offers: the missing zero, the usual basil, nothing invented for a new ingredient
    expect(findings.map((f) => f.suggestion)).toEqual([
      { item: 'milk', quantity: 500, unit: 'L' },
      { item: 'basil', quantity: parLevels(history).get('basil')!.median, unit: 'KG' },
      undefined,
    ]);
    const answered = week.map((o) => (o.item === 'milk' ? findings[0]!.suggestion! : o)).concat(findings[1]!.suggestion!, { item: 'wurstel', quantity: 5, unit: 'KG' });
    expect(reviewWeek(history, DEMO_MENU, answered)).toEqual([]);
  });
});
