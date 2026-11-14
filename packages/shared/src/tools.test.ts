import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AGENT_TOOLS, TOOLS, TOOL_LIST, TOOL_NAMES } from './tools.js';

describe('tool registry', () => {
  it('defines exactly the 7 gateway tools, keyed by name', () => {
    expect(TOOL_NAMES).toEqual([
      'search_products',
      'get_offers',
      'propose_order',
      'approve_order',
      'reject_order',
      'get_order',
      'explain',
    ]);
    for (const [key, tool] of Object.entries(TOOLS)) expect(tool.name).toBe(key);
  });

  it('never exposes approve/reject to agents (MCP)', () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual(['search_products', 'get_offers', 'propose_order', 'get_order', 'explain']);
  });

  it('has unique REST bindings whose path params exist in the input', () => {
    const keys = TOOL_LIST.map((t) => `${t.http.method} ${t.http.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of TOOL_LIST) {
      const params = [...t.http.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
      const shape = t.input.shape;
      for (const p of params) expect(shape, `${t.name}: {${p}}`).toHaveProperty(p);
    }
  });

  it('converts every input and output to JSON Schema (for MCP + OpenAPI)', () => {
    for (const t of TOOL_LIST) {
      const input = z.toJSONSchema(t.input, { io: 'input' });
      expect(input.type, t.name).toBe('object');
      expect(() => z.toJSONSchema(t.output)).not.toThrow();
    }
  });

  it('applies defaults on search_products', () => {
    expect(TOOLS.search_products.input.parse({ text: 'milk' })).toEqual({
      text: 'milk',
      attributes: [],
      freeFromAllergens: [],
      limit: 20,
    });
  });

  it('rejects an agent posing as human approver', () => {
    const r = TOOLS.approve_order.input.safeParse({ orderId: 'ord_1', approver: { type: 'agent', id: 'agent:x' } });
    expect(r.success).toBe(false);
  });
});
