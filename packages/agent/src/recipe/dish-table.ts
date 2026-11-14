/**
 * Fixed fallback recipes for the demo. Used when LLM_PROVIDER=none, when the
 * LLM fails, or in tests. Keep it small: these are the dishes the demo shows.
 */
import type { Suggestion } from './types.js';

type Entry = { aliases: RegExp; suggestion: Suggestion };

export const DISH_TABLE: Entry[] = [
  {
    aliases: /spaghetti.*pesto|pasta.*pesto|pesto.*(pasta|spaghetti)/i,
    suggestion: {
      dish: 'spaghetti al pesto',
      ingredients: [
        { name: 'spaghetti', searchText: 'spaghetti', kind: 'pasta_rice_grain', perServing: 100, unit: 'g', attributes: [], optional: false },
        { name: 'pesto alla genovese', searchText: 'pesto', kind: 'sauce', perServing: 50, unit: 'g', attributes: [], optional: false },
        { name: 'parmigiano grattugiato', searchText: 'parmesan', kind: 'cheese', perServing: 15, unit: 'g', attributes: [], optional: false },
        { name: 'basilico fresco', searchText: 'basil', kind: 'herb_spice', perServing: 2, unit: 'g', attributes: [], optional: true },
      ],
      assumptions: ['ready-made pesto, not made in house', 'parmesan served grated at the table'],
    },
  },
  {
    aliases: /salmon|lohi|salmone/i,
    suggestion: {
      dish: 'oven salmon with potatoes',
      ingredients: [
        { name: 'salmon fillet', searchText: 'salmon fillet', kind: 'protein', perServing: 150, unit: 'g', attributes: [], optional: false },
        { name: 'potatoes', searchText: 'potato', kind: 'vegetable', perServing: 200, unit: 'g', attributes: [], optional: false },
        { name: 'cream', searchText: 'cream', kind: 'dairy_liquid', perServing: 40, unit: 'ml', attributes: [], optional: false },
        { name: 'dill', searchText: 'dill', kind: 'herb_spice', perServing: 2, unit: 'g', attributes: [], optional: true },
      ],
      assumptions: ['fresh fillet, skin on'],
    },
  },
  {
    aliases: /porridge|oat|kaurapuuro|porridge d'avena/i,
    suggestion: {
      dish: 'oat porridge',
      ingredients: [
        { name: 'oat flakes', searchText: 'oat flakes', kind: 'pasta_rice_grain', perServing: 60, unit: 'g', attributes: [], optional: false },
        { name: 'milk', searchText: 'milk', kind: 'dairy_liquid', perServing: 200, unit: 'ml', attributes: [], optional: false },
        { name: 'berries', searchText: 'berries', kind: 'fruit', perServing: 50, unit: 'g', attributes: [], optional: true },
      ],
      assumptions: ['cooked with milk, not water'],
    },
  },
];

export function lookupDish(dishText: string): Suggestion | null {
  const hit = DISH_TABLE.find((e) => e.aliases.test(dishText));
  return hit ? structuredClone(hit.suggestion) : null;
}
