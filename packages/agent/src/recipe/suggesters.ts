/**
 * Ingredient suggesters: given a dish, return ingredients with per-serving
 * amounts. They never compute totals; plan.ts does that.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { GEMINI_DEFAULT_MODEL } from '../llm.js';
import { lookupDish } from './dish-table.js';
import { IngredientKindSchema, SuggestionSchema, type Suggestion } from './types.js';

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

const KINDS = IngredientKindSchema.options;

/** Gemini gets the exact JSON shape and allowed values (it has no schema-constrained output here). */
const GEMINI_PROMPT = `${SYSTEM_PROMPT}
Answer only with JSON: {"dish": string, "ingredients": [{"name": string, "searchText": string, "kind": one of ${KINDS.join(' | ')}, "perServing": number, "unit": "g" | "ml" | "pcs", "attributes": [], "optional": boolean}], "assumptions": [string]}.
searchText: one or two plain English product words, e.g. "carnaroli rice", "porcini", "parmesan". Always leave "attributes" empty.`;

/** LLM answers drift: map unknown kinds to the nearest family, drop free-text attributes (only catalogue codes may go there). */
export function normaliseSuggestion(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as { ingredients?: unknown[] };
  const guess = (text: string): string => {
    const t = text.toLowerCase();
    if (/rice|riso|pasta|grain|flour|farina|oat|bread crumb/.test(t)) return 'pasta_rice_grain';
    if (/bread|bun|baguette|ciabatta|focaccia/.test(t)) return 'bread_bakery';
    if (/cheese|parmesan|parmigiano|mozzarella|grana|pecorino/.test(t)) return 'cheese';
    if (/milk|cream|panna|latte|yogh?urt/.test(t)) return 'dairy_liquid';
    if (/butter|oil|olio|burro/.test(t)) return 'fat_oil';
    if (/herb|spice|salt|pepper|parsley|basil|thyme|oregano|garlic/.test(t)) return 'herb_spice';
    if (/meat|beef|pork|chicken|fish|salmon|shrimp|egg/.test(t)) return 'protein';
    if (/fruit|berry|apple|lemon/.test(t)) return 'fruit';
    if (/sauce|pesto|stock|broth|brodo|wine|vino/.test(t)) return 'sauce';
    if (/mushroom|funghi|porcini|onion|cipoll|vegetable|produce|tomat|carrot|potato/.test(t)) return 'vegetable';
    return 'other';
  };
  return {
    ...r,
    ingredients: (r.ingredients ?? []).map((ing) => {
      const i = (ing ?? {}) as Record<string, unknown>;
      const kind = KINDS.includes(i.kind as never) ? i.kind : guess(`${i.kind ?? ''} ${i.name ?? ''} ${i.searchText ?? ''}`);
      const unit = ['g', 'ml', 'pcs'].includes(String(i.unit)) ? i.unit : 'g';
      return { ...i, kind, unit, attributes: [], optional: Boolean(i.optional) };
    }),
    assumptions: Array.isArray((r as { assumptions?: unknown }).assumptions) ? (r as { assumptions: unknown[] }).assumptions.map(String) : [],
  };
}

/**
 * Gemini-backed suggester.
 * Reads GEMINI_API_KEY from the environment.
 */
export function geminiSuggester(opts: { model?: string; apiKey?: string; fetchImpl?: typeof fetch } = {}): IngredientSuggester {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  const model = opts.model ?? process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL;
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    source: 'llm',
    async suggest(dishText) {
      if (!apiKey) return null;
      try {
        const response = await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            signal: AbortSignal.timeout(15_000),
            body: JSON.stringify({
              contents: [{ parts: [{ text: `Dish: ${dishText}` }] }],
              systemInstruction: { parts: [{ text: GEMINI_PROMPT }] },
              generationConfig: {
                responseMimeType: 'application/json',
              },
            }),
          },
        );
        if (!response.ok) return null;
        const body = (await response.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const reply = body.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!reply) return null;
        return SuggestionSchema.parse(normaliseSuggestion(JSON.parse(reply)));
      } catch {
        return null;
      }
    },
  };
}

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

/** Picks suggesters from LLM_PROVIDER or available keys: gemini → Gemini then table; anthropic → Claude then table; anything else → table only. */
export function defaultSuggester(env: NodeJS.ProcessEnv = process.env) {
  if (env.GEMINI_API_KEY || env.LLM_PROVIDER === 'gemini') {
    // table first: its demo recipes carry Aimo category codes (precise product matches); Gemini for any other dish
    return chainSuggesters(tableSuggester, geminiSuggester({ apiKey: env.GEMINI_API_KEY }));
  }
  if (env.LLM_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) {
    return chainSuggesters(tableSuggester, anthropicSuggester());
  }
  return chainSuggesters(tableSuggester);
}
