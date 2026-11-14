import { expect, test } from 'vitest';
import { draftFrom, expectedWeek, history, isoWeek, parseMessage, yearHistory } from './kitchen';

test('reads quantity-first and item-first lines, thousands and decimals', () => {
  expect(parseMessage('1,000 L lactose-free milk by Monday, 40 kg mozzarella and basil 1,5 kg').lines).toEqual([
    { item: 'lactose-free milk', quantity: 1000, unit: 'L' },
    { item: 'mozzarella', quantity: 40, unit: 'KG' },
    { item: 'basil', quantity: 1.5, unit: 'KG' },
  ]);
  expect(parseMessage('5000 litres of milk\n20 pcs wurstel').lines).toEqual([
    { item: 'milk', quantity: 5000, unit: 'L' },
    { item: 'wurstel', quantity: 20, unit: 'ST' },
  ]);
});

test('ISO week numbers as used in Finland, and the year history starts at week 1', () => {
  expect(isoWeek('2026-11-16')).toBe(47);
  expect(isoWeek('2025-12-29')).toBe(1); // 1 Jan 2026 is a Thursday
  expect(isoWeek('2026-12-28')).toBe(53);
  expect(isoWeek('2021-01-03')).toBe(53); // a Sunday that still belongs to 2020's week 53
  expect(yearHistory.map((w) => isoWeek(w.week))).toEqual(Array.from({ length: 46 }, (_, i) => i + 1));
  expect(history).toHaveLength(12);
});

test('says what it could not read instead of guessing', () => {
  const parsed = parseMessage('some milk, 30 kg tomatoes');
  expect(parsed.lines).toEqual([{ item: 'tomatoes', quantity: 30, unit: 'KG' }]);
  expect(parsed.unread).toEqual(['some milk']);
});

test('"my usual order" starts from the history and the message overrides single lines', () => {
  const parsed = parseMessage('My usual order, but 5000 L milk');
  expect(parsed.usual).toBe(true);
  expect(parsed.unread).toEqual([]);
  const draft = draftFrom(parsed);
  expect(draft.filter((o) => o.item === 'milk')).toEqual([{ item: 'milk', quantity: 5000, unit: 'L' }]);
  expect(draft).toHaveLength(expectedWeek(history).length);
  expect(draftFrom(parseMessage('usual order without basil')).some((o) => o.item === 'basil')).toBe(false);
  // the corrected line stays where it was, so the read-back keeps its order
  expect(draft.findIndex((o) => o.item === 'milk')).toBe(expectedWeek(history).findIndex((o) => o.item === 'milk'));
});
