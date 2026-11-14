import { describe, expect, it } from 'vitest';
import { StructuredNeed } from './contract.js';
import { createProvider, extractNeed, MAX_QUANTITY, ruleParseNeed, type LLMProvider } from './llm.js';

const NOW = new Date('2026-11-13T18:00:00Z'); // Friday
const DEMO = 'I need 1,000 litres of lactose-free milk by Monday';
const BUTTER = '5 kg butter by 2026-11-20'; // the request that validNeed answers
const none = createProvider({ LLM_PROVIDER: 'none' });

const validNeed = {
  quantity: 5,
  unit: 'KG',
  productQuery: 'butter',
  attributes: [],
  freeFromAllergens: [],
  deliveryBy: '2026-11-20',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('rule parser (LLM_PROVIDER=none)', () => {
  it('parses the demo phrase', async () => {
    const result = await extractNeed(DEMO, none, NOW);
    expect(result.usedFallback).toBe(false);
    expect(StructuredNeed.parse(result.need)).toEqual({
      quantity: 1000,
      unit: 'L',
      productQuery: 'milk',
      attributes: ['lactose-free'],
      freeFromAllergens: [],
      deliveryBy: '2026-11-16',
    });
  });

  it('parses decimals, kg, gluten free and tomorrow', () => {
    expect(ruleParseNeed('Please send 2.5 kg gluten free oat flour tomorrow', NOW)).toMatchObject({
      quantity: 2.5,
      unit: 'KG',
      productQuery: 'oat flour',
      attributes: ['gluten-free'],
      deliveryBy: '2026-11-14',
    });
  });

  it('defaults to pieces, reads allergens and ISO dates', () => {
    expect(ruleParseNeed('200 croissants without nuts by 2026-11-20', NOW)).toMatchObject({
      quantity: 200,
      unit: 'PCS',
      productQuery: 'croissants',
      freeFromAllergens: ['nuts'],
      deliveryBy: '2026-11-20',
    });
  });

  it('a weekday named on that same weekday means next week', () => {
    expect(ruleParseNeed('10 l milk by friday', NOW).deliveryBy).toBe('2026-11-20');
  });

  it('resolves dates on the Helsinki calendar, not UTC', () => {
    // 22:30 UTC on Friday is already Saturday in Helsinki
    expect(ruleParseNeed('10 l milk tomorrow', new Date('2026-11-13T22:30:00Z')).deliveryBy).toBe('2026-11-15');
  });

  it('leaves deliveryBy null when no date is given', () => {
    expect(ruleParseNeed('10 l milk', NOW).deliveryBy).toBeNull();
  });

  it.each([
    ['1.000 litres of milk', 1000, 'L'],
    ['1 000 litres of milk', 1000, 'L'],
    ['1,000 litres of milk', 1000, 'L'],
    ['12 500 kg flour', 12500, 'KG'],
    ['1.000,5 kg flour', 1000.5, 'KG'],
    ['1,000.5 kg flour', 1000.5, 'KG'],
    ['1,5 kg butter', 1.5, 'KG'],
    ['0,500 kg butter', 0.5, 'KG'],
    ['2.25 kg butter', 2.25, 'KG'],
    ['500 g butter', 0.5, 'KG'],
    ['500 ml cream', 0.5, 'L'],
    ['3 dl cream', 0.3, 'L'],
    ['200 green apples', 200, 'PCS'],
  ])('reads the number and unit in %j', (text, quantity, unit) => {
    expect(ruleParseNeed(text, NOW)).toMatchObject({ quantity, unit });
  });

  it.each(['1.2.3 kg butter', '1,2,3 kg butter', '1.000.5 kg butter', '1 000,5,5 kg butter', '12,34,567 kg butter'])('refuses to guess the ambiguous number in %j', (text) => {
    expect(() => ruleParseNeed(text, NOW)).toThrow(/ambiguous/i);
  });

  it('reads Finnish dates, with and without a year', () => {
    expect(ruleParseNeed('10 l milk by 20.11.2026', NOW)).toMatchObject({ quantity: 10, deliveryBy: '2026-11-20' });
    expect(ruleParseNeed('10 l milk 5.12.', NOW)).toMatchObject({ quantity: 10, deliveryBy: '2026-12-05' });
    // a day and month that have already passed this year mean next year
    expect(ruleParseNeed('10 l milk 2.1.', NOW).deliveryBy).toBe('2027-01-02');
    expect(() => ruleParseNeed('10 l milk 31.2.2027', NOW)).toThrow(/date/i);
  });

  it('rejects a delivery date before today (Helsinki), from the rules and from the LLM', async () => {
    await expect(extractNeed('10 l milk by 2026-11-12', none, NOW)).rejects.toThrow(/before today/);
    await expect(extractNeed('10 l milk by 12.11.2026', none, NOW)).rejects.toThrow(/before today/);
    expect((await extractNeed('10 l milk by 2026-11-13', none, NOW)).need.deliveryBy).toBe('2026-11-13');
    // 22:30 UTC is already the 14th in Helsinki
    await expect(extractNeed('10 l milk by 2026-11-13', none, new Date('2026-11-13T22:30:00Z'))).rejects.toThrow(/before today/);

    const stale: LLMProvider = { name: 'fake', parseNeed: async () => ({ ...validNeed, deliveryBy: '2020-01-01' }) };
    expect(await extractNeed(BUTTER, stale, NOW)).toMatchObject({ usedFallback: true, need: { deliveryBy: '2026-11-20' } });
  });

  it.each(['', '   ', 'milk please', '10 litres', '💥 ; DROP TABLE'])('rejects %j', (text) => {
    expect(() => ruleParseNeed(text, NOW)).toThrow();
  });
});

describe('LLM output handling', () => {
  const fake = (out: () => unknown): LLMProvider => ({ name: 'fake', parseNeed: async () => out() });

  it('uses valid LLM output', async () => {
    const result = await extractNeed(BUTTER, fake(() => validNeed), NOW);
    expect(result).toMatchObject({ provider: 'fake', usedFallback: false, need: validNeed });
  });

  it('falls back to the rule parser on invalid LLM output and records it', async () => {
    const result = await extractNeed(DEMO, fake(() => ({ quantity: 'lots', unit: 'BARRELS' })), NOW);
    expect(result.usedFallback).toBe(true);
    expect(result.provider).toBe('none');
    expect(result.fallbackReason).toBeTruthy();
    expect(result.need).toMatchObject({ quantity: 1000, unit: 'L', deliveryBy: '2026-11-16' });
  });

  it('never lets LLM output drop a constraint or change a quantity the rules found', async () => {
    const text = '200 croissants without nuts, gluten free, by 2026-11-20';
    const lenient = { quantity: 2000, unit: 'PCS', productQuery: 'croissants', attributes: ['vegan'], freeFromAllergens: ['egg'], deliveryBy: '2026-11-20' };
    const result = await extractNeed(text, fake(() => lenient), NOW);
    expect(result.usedFallback).toBe(false);
    expect(result.need.attributes.sort()).toEqual(['gluten-free', 'vegan']);
    expect(result.need.freeFromAllergens.sort()).toEqual(['egg', 'nuts']);
    expect(result.need.quantity).toBe(200);
    expect(result.notes?.join(' ')).toContain('quantity');
  });

  it('rejects quantities above MAX_QUANTITY from the LLM and from the rules', async () => {
    const huge = await extractNeed(BUTTER, fake(() => ({ ...validNeed, quantity: MAX_QUANTITY + 1 })), NOW);
    expect(huge).toMatchObject({ usedFallback: true, need: { quantity: 5 } });
    expect((await extractNeed(`${MAX_QUANTITY} kg butter`, none, NOW)).need.quantity).toBe(MAX_QUANTITY);
    await expect(extractNeed(`${MAX_QUANTITY + 1} kg butter`, none, NOW)).rejects.toThrow(/quantity/i);
  });

  it('falls back when the LLM call throws', async () => {
    const result = await extractNeed(DEMO, fake(() => { throw new Error('network down'); }), NOW);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toContain('network down');
  });
});

describe('createProvider', () => {
  it('defaults to none and rejects unknown providers and missing keys', () => {
    expect(createProvider({}).name).toBe('none');
    expect(() => createProvider({ LLM_PROVIDER: 'gpt' })).toThrow(/LLM_PROVIDER/);
    expect(() => createProvider({ LLM_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => createProvider({ LLM_PROVIDER: 'openrouter' })).toThrow(/OPENROUTER_API_KEY/);
  });

  it('openrouter: sends model and key, parses JSON out of the reply', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ choices: [{ message: { content: 'Sure:\n```json\n' + JSON.stringify(validNeed) + '\n```' } }] });
    };
    const llm = createProvider(
      { LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'some/model' },
      fetchImpl as typeof fetch,
    );
    const result = await extractNeed(BUTTER, llm, NOW);
    expect(result).toMatchObject({ provider: 'openrouter', usedFallback: false, need: validNeed });
    const call = calls[0]!;
    expect(call.url).toContain('openrouter.ai');
    expect((call.init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(JSON.parse(String(call.init.body)).model).toBe('some/model');
  });

  it('openrouter: non-JSON reply or HTTP error falls back', async () => {
    const env = { LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'm' };
    const prose = createProvider(env, (async () => jsonResponse({ choices: [{ message: { content: 'no idea' } }] })) as typeof fetch);
    expect((await extractNeed(DEMO, prose, NOW)).usedFallback).toBe(true);
    const down = createProvider(env, (async () => jsonResponse({ error: 'rate limited' }, 429)) as typeof fetch);
    expect((await extractNeed(DEMO, down, NOW)).usedFallback).toBe(true);
  });

  it('LLM calls are bounded: a timeout falls back to the rule parser', async () => {
    const timeout = () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };

    let signal: AbortSignal | null | undefined;
    const openrouter = createProvider({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'm' }, (async (_url: any, init: any) => {
      signal = init.signal;
      return timeout();
    }) as typeof fetch);
    const viaOpenRouter = await extractNeed(DEMO, openrouter, NOW);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(viaOpenRouter).toMatchObject({ usedFallback: true, need: { quantity: 1000 } });
    expect(viaOpenRouter.fallbackReason).toContain('timeout');

    let calls = 0;
    const anthropic = createProvider({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' }, (async () => {
      calls += 1;
      return timeout();
    }) as typeof fetch);
    const viaAnthropic = await extractNeed(DEMO, anthropic, NOW);
    expect(viaAnthropic).toMatchObject({ usedFallback: true, need: { quantity: 1000 } });
    expect(calls).toBe(2); // one retry, not the SDK default of two
  });

  it('anthropic: uses the default haiku model and parses the reply', async () => {
    let body: any;
    const fetchImpl = async (_url: any, init: any) => {
      body = JSON.parse(String(init.body));
      return jsonResponse({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: JSON.stringify(validNeed) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    };
    const llm = createProvider({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' }, fetchImpl as typeof fetch);
    const result = await extractNeed(BUTTER, llm, NOW);
    expect(result).toMatchObject({ provider: 'anthropic', usedFallback: false, need: validNeed });
    expect(body.model).toBe('claude-haiku-5-5');
  });
});
