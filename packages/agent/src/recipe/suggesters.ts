/**
 * Ingredient suggesters: given a dish, return ingredients with per-serving
 * amounts. They never compute totals; plan.ts does that.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { lookupDish } from './dish-table.js';
import { SuggestionSchema, type Suggestion } from './types.js';

export interface IngredientSuggester {
  readonly source: 'llm' | 'table';
  /** Returns null when this suggester does not know the dish. */
  suggest(dishText: string): Promise<Suggestion | null>;
}

/** Fixed demo table; no network, deterministic. */
export const tableSuggester: IngredientSuggester = {
  source: 'table',
  async suggest(dishText) {
    return lookupDish(dishText);
  },
};

const SYSTEM_PROMPT = `You help a professional kitchen buy ingredients from a food-service wholesaler.
Given a dish, list the ingredients a kitchen must BUY to cook it, with the amount for ONE serving.
- Prefer ready-made components a professional kitchen would buy (e.g. ready pesto) and say so in assumptions.
- Leave out water, salt and pepper unless they are central to the dish.
- searchText: a short English product search term for a wholesale catalogue (e.g. "spaghetti", "parmesan").
- kind: the ingredient family. unit: g for solids, ml for liquids, pcs only for countable items like eggs.
- Mark garnish as optional.
- If the text is not a dish, return one ingredient with kind "other" and explain in assumptions.`;

/**
 * Claude-backed suggester (Haiku: cheap and fast; this is extraction, not reasoning).
 * Reads ANTHROPIC_API_KEY from the environment. Output is schema-validated by the SDK.
 */
export function anthropicSuggester(opts: { model?: string; client?: Anthropic } = {}): IngredientSuggester {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? 'claude-haiku-5-5';
  return {
    source: 'llm',
    async suggest(dishText) {
      const response = await client.messages.parse({
        model,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Dish: ${dishText}` }],
        output_config: { format: zodOutputFormat(SuggestionSchema) },
      });
      if (response.stop_reason === 'refusal') return null;
      return response.parsed_output ?? null;
    },
  };
}

/** Tries each suggester in order; first non-null answer wins. */
export function chainSuggesters(...chain: IngredientSuggester[]): IngredientSuggester & {
  suggestWithSource(dishText: string): Promise<{ suggestion: Suggestion; source: 'llm' | 'table' } | null>;
} {
  return {
    source: chain[0]?.source ?? 'table',
    async suggest(dishText) {
      return (await this.suggestWithSource(dishText))?.suggestion ?? null;
    },
    async suggestWithSource(dishText) {
      for (const s of chain) {
        try {
          const out = await s.suggest(dishText);
          if (out) return { suggestion: out, source: s.source };
        } catch {
          // LLM down / no key / rate limited → fall through to the next suggester
        }
      }
      return null;
    },
  };
}

/** Picks suggesters from LLM_PROVIDER: anthropic → Claude then table; anything else → table only. */
export function defaultSuggester(env: NodeJS.ProcessEnv = process.env) {
  if (env.LLM_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) {
    return chainSuggesters(anthropicSuggester(), tableSuggester);
  }
  return chainSuggesters(tableSuggester);
}
