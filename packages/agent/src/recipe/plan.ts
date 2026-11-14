/**
 * planDish: chef sentence → RecipePlan (ingredient lines with catalogue quantities).
 *
 *   "Dinner, spaghetti al pesto per 10 persone"
 *     → parseChefRequest   (code)   servings=10, meal=dinner, dish="spaghetti al pesto"
 *     → suggester          (LLM/table) ingredients + grams per serving
 *     → clamp + multiply   (code)   1.0 KG spaghetti, 0.5 KG pesto, 0.15 KG parmesan
 *     → RecipePlan with every assumption listed
 *
 * The plan's lines are then fed to search_products / get_offers / propose_order
 * exactly like a direct request ("1,000 L lactose-free milk by Monday").
 */
import { parseChefRequest } from './parse-request.js';
import { clampPortion, toCatalogueUnit } from './portions.js';
import { chainSuggesters, defaultSuggester, type IngredientSuggester } from './suggesters.js';
import { RecipePlanSchema, type IngredientLine, type RecipePlan } from './types.js';

export class RecipeError extends Error {
  constructor(
    message: string,
    readonly code: 'NO_DISH' | 'UNKNOWN_DISH',
  ) {
    super(message);
  }
}

export interface PlanDishOptions {
  suggester?: IngredientSuggester;
  today?: Date;
  /** Used when the chef gives no number; null → error is NOT raised, default applies and is noted. */
  defaultServings?: number;
}

export async function planDish(text: string, opts: PlanDishOptions = {}): Promise<RecipePlan> {
  const parsed = parseChefRequest(text, opts.today);
  const assumptions = [...parsed.notes];

  if (!parsed.dishText) throw new RecipeError('No dish found in the request', 'NO_DISH');

  let servings = parsed.servings;
  if (servings === null) {
    servings = opts.defaultServings ?? 1;
    assumptions.push(`number of servings not given, assumed ${servings}`);
  }
  if (parsed.neededBy === null) {
    assumptions.push('delivery date not given: next available delivery');
  }

  const chain = opts.suggester ? chainSuggesters(opts.suggester) : defaultSuggester();
  const result = await chain.suggestWithSource(parsed.dishText);
  if (!result) {
    throw new RecipeError(`Unknown dish "${parsed.dishText}": list the ingredients instead`, 'UNKNOWN_DISH');
  }
  const { suggestion, source } = result;
  assumptions.push(...suggestion.assumptions);

  const lines: IngredientLine[] = suggestion.ingredients.map((ing) => {
    const { value, clamped } = clampPortion(ing.kind, ing.unit, ing.perServing);
    if (clamped) {
      assumptions.push(
        `${ing.name}: ${ing.perServing} ${ing.unit}/serving looked wrong, corrected to ${value} ${ing.unit}`,
      );
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

  return RecipePlanSchema.parse({
    text,
    dish: suggestion.dish,
    servings,
    meal: parsed.meal,
    neededBy: parsed.neededBy,
    lines,
    assumptions,
    source,
  });
}
