import { describe, expect, it } from 'vitest';
import { DEMO_MENU, expectedWeek, parLevels, reviewWeek, syntheticHistory, type WeekOrder } from './history.js';

const MARGHERITA = DEMO_MENU.filter((dish) => dish.name === 'pizza margherita');
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * Outside judge: for 20 seeded histories, the last 4 weeks are held out. Each held-out week is
 * reviewed as it really was (must raise nothing), then with one planted slip at a time: a dropped
 * item, ×10, ÷10. Every slip must be caught, and nothing else may be flagged.
 */
describe('reviewWeek against planted slips on held-out weeks', () => {
  const runs = SEEDS.flatMap((seed) => {
    const history = syntheticHistory(seed, 16, '2026-11-16');
    return [12, 13, 14, 15].map((i) => ({ seed, i, past: history.slice(0, i), week: history[i]!.orders }));
  });

  it('raises no false alarm on the real held-out weeks', () => {
    const alarms = runs.flatMap(({ past, week }) => reviewWeek(past, MARGHERITA, week));
    expect(alarms).toEqual([]);
  });

  it('catches every planted slip and flags nothing else', () => {
    let planted = 0;
    let caught = 0;
    const extra: string[] = [];
    for (const { past, week } of runs) {
      for (const order of week) {
        const slips: [WeekOrder[], 'missing' | 'quantity'][] = [
          [week.filter((o) => o !== order), 'missing'],
          [week.map((o) => (o === order ? { ...o, quantity: o.quantity * 10 } : o)), 'quantity'],
          [week.map((o) => (o === order ? { ...o, quantity: o.quantity / 10 } : o)), 'quantity'],
        ];
        for (const [slipped, kind] of slips) {
          planted++;
          const findings = reviewWeek(past, MARGHERITA, slipped);
          if (findings.some((f) => f.item === order.item && f.kind === kind)) caught++;
          extra.push(...findings.filter((f) => f.item !== order.item).map((f) => f.message));
        }
      }
    }
    expect(planted).toBeGreaterThan(1000);
    expect(caught / planted).toBe(1); // recall 100 %
    expect(extra).toEqual([]); // no false alarms next to a real slip
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
  });
});
