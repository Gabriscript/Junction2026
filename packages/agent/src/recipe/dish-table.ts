/**
 * Fixed fallback recipes for the demo. Used when LLM_PROVIDER=none, when the
 * LLM fails, or in tests. Keep it small: these are the dishes the demo shows.
 */
import type { Suggestion } from './types.js';

type Entry = { aliases: RegExp; suggestion: Suggestion } | { aliases: RegExp; build: (dishText: string) => Suggestion };

/** Ice-cream flavours recognised in "gelato vaniglia e cioccolato" (typo-tolerant). */
const FLAVOURS: Array<{ re: RegExp; name: string; search: string }> = [
  { re: /vani+l+[ij]?a|vanilla/i, name: 'vanilla', search: 'vanilla ice cream' },
  { re: /cioc+o?lat|chocolate|suklaa/i, name: 'chocolate', search: 'chocolate ice cream' },
  { re: /fragol|strawberr|mansikka/i, name: 'strawberry', search: 'strawberry ice cream' },
  { re: /pistac|pistach/i, name: 'pistachio', search: 'pistachio ice cream' },
];

/** One scoop per flavour; with one flavour, two scoops. ~70 ml per scoop. */
function buildGelato(dishText: string): Suggestion {
  const found = FLAVOURS.filter((f) => f.re.test(dishText));
  const flavours = found.length ? found : [{ name: 'vanilla', search: 'vanilla ice cream' }];
  const perFlavour = found.length > 1 ? 70 : 140;
  return {
    dish: `gelato ${flavours.map((f) => f.name).join(' & ')}`,
    ingredients: flavours.map((f) => ({
      name: `${f.name} ice cream`,
      searchText: f.search,
      kind: 'dairy_liquid' as const,
      perServing: perFlavour,
      unit: 'ml' as const,
      attributes: [],
      optional: false,
    })),
    assumptions: [
      found.length ? `one ~70 ml scoop per flavour (${flavours.length} flavours)` : 'flavour not given, assumed vanilla',
    ],
  };
}

export const DISH_TABLE: Entry[] = [
  {
    aliases: /bruschett/i,
    suggestion: {
      dish: 'bruschette pomodorini, mozzarella e origano',
      ingredients: [
        { name: 'ciabatta bread', searchText: 'ciabatta', kind: 'bread_bakery', perServing: 60, unit: 'g', attributes: [], optional: false },
        { name: 'pomodorini (small tomatoes)', searchText: 'tomato', kind: 'vegetable', perServing: 60, unit: 'g', attributes: [], optional: false },
        { name: 'mozzarella', searchText: 'mozzarella', kind: 'cheese', perServing: 40, unit: 'g', attributes: [], optional: false },
        { name: 'oregano', searchText: 'oregano', kind: 'herb_spice', perServing: 0.5, unit: 'g', attributes: [], optional: false },
      ],
      assumptions: ['2 bruschette per person as appetizer'],
    },
  },
  {
    aliases: /fusilli.*pesto|pesto.*fusilli/i,
    suggestion: {
      dish: 'fusilli al pesto',
      ingredients: [
        { name: 'fusilli', searchText: 'fusilli', kind: 'pasta_rice_grain', perServing: 100, unit: 'g', attributes: [], optional: false },
        { name: 'pesto alla genovese', searchText: 'pesto', kind: 'sauce', perServing: 50, unit: 'g', attributes: [], optional: false },
        { name: 'parmigiano grattugiato', searchText: 'parmesan', kind: 'cheese', perServing: 15, unit: 'g', attributes: [], optional: false },
      ],
      assumptions: ['ready-made pesto, not made in house'],
    },
  },
  {
    aliases: /gelato|ice ?cream|j[aä][aä]tel[oö]/i,
    build: buildGelato,
  },
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
  if (!hit) return null;
  return 'build' in hit ? hit.build(dishText) : structuredClone(hit.suggestion);
}
