/**
 * planMenu: a whole reservation / menu → one shopping list.
 *
 *   "tomorrow dinner, 10 people, appetizer bruschette pomodorini mozzarella origano,
 *    fusilli al pesto, gelato vaniglia e cioccolato dessert"
 *     → header: servings=10, meal=dinner, neededBy=tomorrow
 *     → dishes: bruschette (appetizer), fusilli al pesto, gelato vanilla & chocolate (dessert)
 *     → lines per dish, then merged across dishes (e.g. one mozzarella line if two dishes use it)
 *
 * Same rules as planDish: the suggester (LLM or table) only gives per-serving
 * amounts; code does servings, dates, totals, clamping and units.
 */
import { z } from 'zod';
import { parseChefRequest } from './parse-request.js';
import { RecipeError } from './plan.js';
import { clampPortion, toCatalogueUnit } from './portions.js';
import { chainSuggesters, defaultSuggester, type IngredientSuggester } from './suggesters.js';
import { IngredientLineSchema, type IngredientLine } from './types.js';

export const CourseSchema = z.enum(['appetizer', 'main', 'dessert']).nullable();

export const MenuLineSchema = IngredientLineSchema.extend({
  /** Dishes that need this ingredient (after merging). */
  usedIn: z.array(z.string()).min(1),
});
export type MenuLine = z.infer<typeof MenuLineSchema>;

export const MenuPlanSchema = z.object({
  text: z.string(),
  servings: z.number().int().positive(),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'event']).nullable(),
  neededBy: z.string().nullable(),
  dishes: z
    .array(
      z.object({
        dish: z.string(),
        course: CourseSchema,
        source: z.enum(['llm', 'table']),
        lines: z.array(IngredientLineSchema).min(1),
      }),
    )
    .min(1),
  /** Shopping list: dish lines merged by product search text + unit. Feed these to search/offers. */
  lines: z.array(MenuLineSchema).min(1),
  /** Dishes nobody could plan: the UI asks the chef to list their ingredients. */
  unknownDishes: z.array(z.string()),
  assumptions: z.array(z.string()),
});
export type MenuPlan = z.infer<typeof MenuPlanSchema>;

type Course = 'appetizer' | 'main' | 'dessert';

const COURSE_WORDS: Array<[RegExp, Course]> = [
  [/\b(appetizers?|antipast[oi]|starters?|alkuruoka)\b/i, 'appetizer'],
  [/\b(main course|main|primo|secondo|pääruoka)\b/i, 'main'],
  [/\b(desserts?|dolce|dolci|jälkiruoka)\b/i, 'dessert'],
];
const NOISE = /\b(reservation|prenotazione|booking|varaus|menu)\b/gi;

function stripCourse(text: string): { dishText: string; course: Course | null } {
  let course: Course | null = null;
  let out = text;
  for (const [re, c] of COURSE_WORDS) {
    if (re.test(out)) {
      course ??= c;
      out = out.replace(re, ' ');
    }
  }
  return { dishText: out.replace(/\s+/g, ' ').trim(), course };
}

export interface PlanMenuOptions {
  suggester?: IngredientSuggester;
  today?: Date;
  defaultServings?: number;
}

export async function planMenu(text: string, opts: PlanMenuOptions = {}): Promise<MenuPlan> {
  const assumptions: string[] = [];
  let servings: number | null = null;
  let meal: MenuPlan['meal'] = null;
  let neededBy: string | null = null;
  const dishSegments: Array<{ dishText: string; course: Course | null }> = [];
  let pendingCourse: Course | null = null;

  for (const raw of text.replace(NOISE, ' ').split(/[\n;,:]+/)) {
    if (!raw.trim()) continue;
    const p = parseChefRequest(raw, opts.today);
    servings ??= p.servings;
    meal ??= p.meal;
    if (neededBy === null && p.neededBy) {
      neededBy = p.neededBy;
      assumptions.push(...p.notes);
    }
    const { dishText, course } = stripCourse(p.dishText);
    // "Dessert: gelato…" is split at the colon: a lone course word applies to the next dish
    if (!dishText) {
      if (course) pendingCourse = course;
      continue;
    }
    dishSegments.push({ dishText, course: course ?? pendingCourse });
    pendingCourse = null;
  }

  if (dishSegments.length === 0) throw new RecipeError('No dish found in the request', 'NO_DISH');
  if (servings === null) {
    servings = opts.defaultServings ?? 1;
    assumptions.push(`number of servings not given, assumed ${servings}`);
  }
  if (neededBy === null) assumptions.push('delivery date not given: next available delivery');

  const chain = opts.suggester ? chainSuggesters(opts.suggester) : defaultSuggester();
  const dishes: MenuPlan['dishes'] = [];
  const unknownDishes: string[] = [];

  for (const seg of dishSegments) {
    const result = await chain.suggestWithSource(seg.dishText);
    if (!result) {
      unknownDishes.push(seg.dishText);
      assumptions.push(`"${seg.dishText}": unknown dish, please list its ingredients`);
      continue;
    }
    const { suggestion, source } = result;
    assumptions.push(...suggestion.assumptions.map((a) => `${suggestion.dish}: ${a}`));
    const lines: IngredientLine[] = suggestion.ingredients.map((ing) => {
      const { value, clamped } = clampPortion(ing.kind, ing.unit, ing.perServing);
      if (clamped) {
        assumptions.push(`${ing.name}: ${ing.perServing} ${ing.unit}/serving looked wrong, corrected to ${value} ${ing.unit}`);
      }
      const total = value * servings!;
      return {
        ...ing,
        perServing: value,
        total,
        catalogue: toCatalogueUnit(ing.unit, total),
        ...(clamped ? { clampedFrom: ing.perServing } : {}),
      };
    });
    dishes.push({ dish: suggestion.dish, course: seg.course, source, lines });
  }

  if (dishes.length === 0) {
    throw new RecipeError(`Unknown dishes: ${unknownDishes.join(', ')}. List the ingredients instead`, 'UNKNOWN_DISH');
  }

  // merge identical ingredients across dishes (same search text and unit)
  const merged = new Map<string, MenuLine>();
  for (const d of dishes) {
    for (const l of d.lines) {
      const key = `${l.searchText.toLowerCase()}|${l.unit}`;
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, { ...l, usedIn: [d.dish] });
        continue;
      }
      const total = prev.total + l.total;
      merged.set(key, {
        ...prev,
        perServing: prev.perServing + l.perServing,
        total,
        catalogue: toCatalogueUnit(l.unit, total),
        optional: prev.optional && l.optional,
        usedIn: [...prev.usedIn, d.dish],
      });
    }
  }

  return MenuPlanSchema.parse({
    text,
    servings,
    meal,
    neededBy,
    dishes,
    lines: [...merged.values()],
    unknownDishes,
    assumptions,
  });
}
