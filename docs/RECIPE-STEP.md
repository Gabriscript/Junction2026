# Recipe step: dish + servings → ingredient lines

Status: **implemented in `packages/agent/src/recipe/`** (branch `feat/agent-recipe-step`), 2026-11-14. Added on top of [PLAN-review.md](PLAN-review.md) after team discussion.

> **To Gabri's Claude:** `packages/agent` is Gabri's package. This module is self-contained and touches nothing else in it (only one export line in `src/index.ts`). Please wire it into Step 7 (need extraction) as described in "How to use it", and into the UI request form (Step 9). Change it freely; it's yours from here.

## Why
Chefs talk in **dishes and covers** ("Dinner, spaghetti al pesto per 10 persone"), while the gateway works in **products and quantities** ("1 KG spaghetti"). Without this step the chef must translate by hand, which costs points on *"Solving the user's need — least manual correction"* (20 %). It also covers the brief's "Need → recipe → order" and "Last-minute event" scenarios, and makes allergens meaningful (pesto → nuts + milk).

## What it does
```
"Dinner, spaghetti al pesto per 10 persone"
  1. parseChefRequest   (code)        servings=10, meal=dinner, dish="spaghetti al pesto", neededBy=null
  2. IngredientSuggester (LLM or table) ingredients + amount PER SERVING
  3. clamp + multiply   (code)        portion sanity bounds, totals, g→KG / ml→L / pcs→ST
  4. RecipePlan                        lines + every assumption listed
```
Result for the example (table suggester):

| line | per serving | total | catalogue |
|---|---|---|---|
| spaghetti | 100 g | 1000 g | 1 KG |
| pesto | 50 g | 500 g | 0.5 KG |
| parmesan | 15 g | 150 g | 0.15 KG |
| basil (optional) | 2 g | 20 g | 0.02 KG |

Assumptions: "delivery date not given: next available delivery", "ready-made pesto, not made in house", "parmesan served grated at the table".

## Design rules (keep them)
- **The LLM never computes numbers.** It only suggests ingredients and grams per serving. Servings, dates, totals and unit conversion are code.
- **Sanity bounds** per ingredient kind (`portions.ts`): e.g. pasta 60–150 g/serving. Out of bounds → clamped, and the correction is added to `assumptions`.
- **Every assumption is visible.** The UI should show `plan.assumptions` with a one-tap correction before ordering.
- **Fallback:** `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` → Claude (`claude-haiku-5-5`, structured output validated with Zod) then the fixed table; anything else → table only. If both fail → `RecipeError('UNKNOWN_DISH')` and the UI asks the chef to list ingredients.
- Demo table (`dish-table.ts`): spaghetti al pesto, oven salmon with potatoes, oat porridge (hospital breakfast).

## How to use it (Step 7 / Step 9)
```ts
import { planDish } from '@junction/agent';

const plan = await planDish('Dinner, spaghetti al pesto per 10 persone');
for (const line of plan.lines) {
  // 1. search the catalogue
  //    search_products({ text: line.searchText, attributes: line.attributes,
  //                      freeFromAllergens: mandate.allergenRules..., unit: line.catalogue.unit })
  // 2. pack math: choose pack sizes covering line.catalogue.quantity (show rounding)
  // 3. get_offers({ items: [...], requestedDate: plan.neededBy ?? nextDeliveryDate })
  // skip lines with line.optional === true if nothing matches
}
// 4. propose_order with all lines; the gateway's policy handles budget, allergens, cut-off, etc.
```
- `plan.neededBy === null` → use the next delivery date and keep the assumption visible.
- Allergen filtering stays in the mandate + gateway (`ALLERGEN_CONFLICT` is always blocked); the recipe step does **not** adapt recipes to allergens (next-steps slide).

## Whole menus: `planMenu` (added 2026-11-14)
A reservation usually has several courses. `planMenu(text)` reads servings, meal and date once, splits the dishes on commas, semicolons, colons and new lines, strips course words (appetizer/antipasto, main/primo, dessert/dolce), plans each dish and **merges identical ingredients** across dishes into one shopping-list line (`usedIn` says which dishes need it).

```ts
import { planMenu } from '@junction/agent';
const menu = await planMenu(
  'tomorrow dinner, 10 people, appetizer bruschette pomodorini mozzarella origano, fusilli al pesto, gelato vaniila e cioccolato dessert',
);
// menu.neededBy = tomorrow, menu.servings = 10, menu.dishes = 3 (with course), menu.lines = shopping list
// menu.unknownDishes = dishes nobody could plan → UI asks the chef to list ingredients (the rest still gets planned)
```

| line | total | used in |
|---|---|---|
| ciabatta | 0.6 KG | bruschette |
| tomato (pomodorini) | 0.6 KG | bruschette |
| mozzarella | 0.4 KG | bruschette |
| oregano | 0.005 KG | bruschette |
| olive oil | 0.05 L | bruschette |
| fusilli | 1 KG | fusilli al pesto |
| pesto | 0.5 KG | fusilli al pesto |
| parmesan | 0.15 KG | fusilli al pesto |
| vanilla ice cream | 0.7 L | gelato (typo "vaniila" recognised) |
| chocolate ice cream | 0.7 L | gelato |

Demo table now has: bruschette, fusilli al pesto, gelato (any of vanilla / chocolate / strawberry / pistachio, typo-tolerant), spaghetti al pesto, salmon with potatoes, oat porridge. Use `planMenu` for the chef request box; `planDish` stays for single dishes.

## Demo idea
Scene "chef": type *Dinner, spaghetti al pesto per 10 persone* → plan with assumptions → signed offers → auto-approved. Variant for the hospital: *porridge for 30 tomorrow* with a nut-free / lactose-free mandate.

## Not done / known limits
- The Claude path was type-checked but **not run against the live API** (no key in the dev `.env` yet). Test with `LLM_PROVIDER=anthropic` once a key is in `.env`.
- No menu planning, no pantry/stock awareness, no recipe adaptation to allergens.
- Portion bounds are rough professional-kitchen values, documented as an assumption.

## Files
- `packages/agent/src/recipe/types.ts` — Zod schemas (`Suggestion`, `IngredientLine`, `RecipePlan`)
- `parse-request.ts` — servings / meal / date / dish text (en, it, some fi)
- `portions.ts` — sanity bounds and unit conversion
- `dish-table.ts` — fallback demo recipes
- `suggesters.ts` — `tableSuggester`, `anthropicSuggester`, `chainSuggesters`, `defaultSuggester`
- `plan.ts` — `planDish()`
- `menu.ts` — `planMenu()` for whole menus / reservations
- `recipe.test.ts`, `menu.test.ts` — 10 tests
