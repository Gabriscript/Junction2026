/**
 * Dish → ingredients step ("recipe step").
 *
 * A chef says "Dinner, spaghetti al pesto per 10 persone". The rest of the
 * agent (search → offers → order) works per product and quantity, so this step
 * turns a dish + number of servings into ingredient lines with totals.
 *
 * Split of work:
 *  - an IngredientSuggester (LLM or fixed table) only proposes ingredients and
 *    grams/ml/pieces PER SERVING;
 *  - deterministic code multiplies, clamps to sane portion bounds, converts to
 *    the catalogue units (KG / L / ST) and records every assumption.
 */
import { z } from 'zod';

/** Ingredient family; drives the per-serving sanity bounds in portions.ts. */
export const IngredientKindSchema = z.enum([
  'pasta_rice_grain',
  'sauce',
  'cheese',
  'protein',
  'vegetable',
  'fruit',
  'dairy_liquid',
  'fat_oil',
  'herb_spice',
  'bread_bakery',
  'other',
]);
export type IngredientKind = z.infer<typeof IngredientKindSchema>;

/** Unit of the per-serving amount. */
export const PortionUnitSchema = z.enum(['g', 'ml', 'pcs']);
export type PortionUnit = z.infer<typeof PortionUnitSchema>;

/** What a suggester returns for one ingredient (per serving, no totals). */
export const SuggestedIngredientSchema = z.object({
  /** Human name, e.g. "spaghetti". */
  name: z.string().min(1),
  /** Search text for the catalogue (English or Finnish), e.g. "spaghetti". */
  searchText: z.string().min(1),
  kind: IngredientKindSchema,
  /** Amount for ONE serving. */
  perServing: z.number().positive(),
  unit: PortionUnitSchema,
  /** Catalogue attribute codes the product must have, e.g. ["LACTOSE_FREE"]. Usually empty. */
  attributes: z.array(z.string()),
  /** Optional ingredient (garnish etc.): skipped when it cannot be sourced. */
  optional: z.boolean(),
  /** Aimo category code that narrows the catalogue search (e.g. "17401" fresh tomatoes). Table recipes set it; LLM ones may not. */
  category: z.string().regex(/^\d{3,6}$/).optional(),
});
export type SuggestedIngredient = z.infer<typeof SuggestedIngredientSchema>;

export const SuggestionSchema = z.object({
  /** Normalised dish name. */
  dish: z.string().min(1),
  ingredients: z.array(SuggestedIngredientSchema).min(1).max(15),
  /** Choices the suggester made, e.g. "ready-made pesto, not home-made". */
  assumptions: z.array(z.string()),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

/** One ingredient line after the deterministic step. */
export const IngredientLineSchema = SuggestedIngredientSchema.extend({
  /** perServing × servings, in `unit`. */
  total: z.number().positive(),
  /** Total converted to the catalogue unit, ready for search_products / get_offers. */
  catalogue: z.object({
    unit: z.enum(['KG', 'L', 'ST']),
    quantity: z.number().positive(),
  }),
  /** Set when perServing was outside sane bounds and was clamped. */
  clampedFrom: z.number().positive().optional(),
});
export type IngredientLine = z.infer<typeof IngredientLineSchema>;

/** Output of the recipe step: the input to the normal search → offers → order flow. */
export const RecipePlanSchema = z.object({
  /** Original chef text. */
  text: z.string(),
  dish: z.string(),
  servings: z.number().int().positive(),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'event']).nullable(),
  /** Delivery needed by (YYYY-MM-DD), or null when the chef did not say. */
  neededBy: z.string().nullable(),
  lines: z.array(IngredientLineSchema).min(1),
  /** Every assumption made, shown to the chef so they can correct with one tap. */
  assumptions: z.array(z.string()),
  /** Where the ingredient list came from. */
  source: z.enum(['llm', 'table']),
});
export type RecipePlan = z.infer<typeof RecipePlanSchema>;
