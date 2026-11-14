import { describe, expect, it } from 'vitest';
import { planMenu } from './menu.js';
import { RecipeError } from './plan.js';
import { tableSuggester } from './suggesters.js';

// Friday 2026-11-13
const TODAY = new Date('2026-11-13T12:00:00Z');

const RESERVATION =
  'tomorrow dinner, 10 people, appetizer bruschette pomodorini mozzarella origano, fusilli al pesto, gelato vaniila e cioccolato dessert';

describe('planMenu', () => {
  it('turns the video reservation into one shopping list', async () => {
    const plan = await planMenu(RESERVATION, { suggester: tableSuggester, today: TODAY });

    expect(plan.servings).toBe(10);
    expect(plan.meal).toBe('dinner');
    expect(plan.neededBy).toBe('2026-11-14');
    expect(plan.dishes.map((d) => [d.dish, d.course])).toEqual([
      ['bruschette pomodorini, mozzarella e origano', 'appetizer'],
      ['fusilli al pesto', null],
      ['gelato vanilla & chocolate', 'dessert'],
    ]);
    expect(plan.unknownDishes).toEqual([]);

    const list = Object.fromEntries(plan.lines.map((l) => [l.searchText, l.catalogue]));
    expect(list['ciabatta']).toEqual({ unit: 'KG', quantity: 0.6 });
    expect(list['tomato']).toEqual({ unit: 'KG', quantity: 0.6 });
    expect(list['mozzarella']).toEqual({ unit: 'KG', quantity: 0.4 });
    expect(list['fusilli']).toEqual({ unit: 'KG', quantity: 1 });
    expect(list['basil pesto']).toEqual({ unit: 'KG', quantity: 0.5 });
    // typo "vaniila" still recognised; one 70 ml scoop per flavour
    expect(list['vanilla ice cream']).toEqual({ unit: 'L', quantity: 0.7 });
    expect(list['chocolate ice cream']).toEqual({ unit: 'L', quantity: 0.7 });
  });

  it('merges an ingredient used by two dishes into one line', async () => {
    const plan = await planMenu('8 pax: spaghetti al pesto; fusilli al pesto', { suggester: tableSuggester, today: TODAY });
    const pesto = plan.lines.filter((l) => l.searchText === 'basil pesto');
    expect(pesto).toHaveLength(1);
    expect(pesto[0]!.total).toBe(800);
    expect(pesto[0]!.usedIn).toEqual(['spaghetti al pesto', 'fusilli al pesto']);
  });

  it('keeps going when one dish is unknown, and lists it for the chef', async () => {
    const plan = await planMenu('dinner for 4, fusilli al pesto, beef wellington', { suggester: tableSuggester, today: TODAY });
    expect(plan.dishes).toHaveLength(1);
    expect(plan.unknownDishes).toEqual(['beef wellington']);
  });

  it('keeps "Course: dish" labels from a written note', async () => {
    const plan = await planMenu('Monday dinner, 10 people\nAppetizer: bruschette pomodorini\nFusilli al pesto\nDessert: gelato vaniglia', {
      suggester: tableSuggester,
      today: TODAY,
    });
    expect(plan.dishes.map((d) => d.course)).toEqual(['appetizer', null, 'dessert']);
  });

  it('recognises the Italian spelling vaniglia', async () => {
    const plan = await planMenu('dessert for 4: gelato vaniglia e cioccolato', { suggester: tableSuggester, today: TODAY });
    expect(plan.lines.map((l) => l.searchText)).toEqual(['vanilla ice cream', 'chocolate ice cream']);
  });

  it('errors when no dish can be planned', async () => {
    await expect(planMenu('dinner for 4, beef wellington', { suggester: tableSuggester, today: TODAY })).rejects.toBeInstanceOf(
      RecipeError,
    );
  });
});
