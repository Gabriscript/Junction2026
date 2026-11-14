import { describe, expect, it } from 'vitest';
import { TOOL_LIST } from '@junction/shared';
import { mcpToolDescriptors, restRoutes } from './bindings.js';

describe('gateway bindings', () => {
  it('exposes 5 agent tools over MCP, never approve/reject', () => {
    const names = mcpToolDescriptors().map((t) => t.name);
    expect(names).toEqual(['search_products', 'get_offers', 'propose_order', 'get_order', 'explain']);
    expect(mcpToolDescriptors(TOOL_LIST)).toHaveLength(5);
  });

  it('marks read-only tools and emits object input schemas', () => {
    for (const t of mcpToolDescriptors()) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.annotations.readOnlyHint).toBe(t.name !== 'propose_order');
    }
  });

  it('binds all 7 tools to REST with Fastify path params', () => {
    const routes = restRoutes();
    expect(routes).toHaveLength(7);
    expect(routes.find((r) => r.tool === 'approve_order')).toEqual({
      tool: 'approve_order',
      method: 'POST',
      url: '/v1/orders/:orderId/approve',
    });
  });
});
