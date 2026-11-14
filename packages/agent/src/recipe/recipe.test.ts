import { describe, expect, it } from 'vitest';
import { parseChefRequest } from './parse-request.js';
import { planDish, RecipeError } from './plan.js';
import { tableSuggester, type IngredientSuggester } from './suggesters.js';

// Friday 2026-11-13
const TODAY = new Date('2026-11-13T12:00:00Z');

describe('parseChefRequest', () => {
  it('reads servings, meal and dish from the chef sentence', () => {
    const p = parseChefRequest('Dinner, spaghetti al pesto per 10 persone', TODAY);
    expect(p.servings).toBe(10);
    expect(p.meal).toBe('dinner');
    expect(p.dishText).toBe('spaghetti al pesto');
    expect(p.neededBy).toBeNull();
  });

  it('reads weekday and tomorrow as dates', () => {
    expect(parseChefRequest('salmon for 20 guests on Monday', TODAY).neededBy).toBe('2026-11-16');
    expect(parseChefRequest('porridge 30 pax tomorrow', TODAY).neededBy).toBe('2026-11-14');
  });
});

describe('planDish', () => {
  it('turns spaghetti al pesto for 10 into catalogue quantities', async () => {
    const plan = await planDish('Dinner, spaghetti al pesto per 10 persone', {
      suggester: tableSuggester,
      today: TODAY,
    });
    expect(plan.servings).toBe(10);
    expect(plan.source).toBe('table');
    const byName = Object.fromEntries(plan.lines.map((l) => [l.searchText, l.catalogue]));
    expect(byName['spaghetti']).toEqual({ unit: 'KG', quantity: 1 });
    expect(byName['basil pesto']).toEqual({ unit: 'KG', quantity: 0.5 });
    expect(byName['parmigiano']).toEqual({ unit: 'KG', quantity: 0.15 });
    expect(plan.assumptions).toContain('delivery date not given: next available delivery');
    expect(plan.assumptions).toContain('ready-made pesto, not made in house');
  });

  it('clamps an absurd LLM portion and says so', async () => {
    const silly: IngredientSuggester = {
      source: 'llm',
      async suggest() {
        return {
          dish: 'spaghetti al pesto',
          ingredients: [
            { name: 'spaghetti', searchText: 'spaghetti', kind: 'pasta_rice_grain', perServing: 900, unit: 'g', attributes: [], optional: false },
          ],
          assumptions: [],
        };
      },
    };
    const plan = await planDish('spaghetti al pesto per 10 persone', { suggester: silly, today: TODAY });
    expect(plan.lines[0]!.perServing).toBe(150);
    expect(plan.lines[0]!.clampedFrom).toBe(900);
    expect(plan.lines[0]!.catalogue).toEqual({ unit: 'KG', quantity: 1.5 });
    expect(plan.assumptions.some((a) => a.includes('corrected to 150'))).toBe(true);
  });

  it('errors clearly when the LLM fails and the dish is not in the table', async () => {
    const broken: IngredientSuggester = {
      source: 'llm',
      async suggest() {
        throw new Error('network down');
      },
    };
    await expect(planDish('beef wellington for 8', { suggester: broken, today: TODAY })).rejects.toBeInstanceOf(
      RecipeError,
    );
  });

  it('assumes 1 serving when the chef gives no number, and notes it', async () => {
    const plan = await planDish('salmon', { suggester: tableSuggester, today: TODAY });
    expect(plan.servings).toBe(1);
    expect(plan.assumptions.some((a) => a.includes('servings not given'))).toBe(true);
  });
});
