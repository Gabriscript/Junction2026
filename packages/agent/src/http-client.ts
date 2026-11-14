/**
 * REST client for the gateway, built from the shared tool registry: method and path come from
 * `TOOLS[name].http`, path params (`{orderId}`) are filled from the input and left out of the body.
 * Responses are returned unparsed: the agent validates every one with `parseOutput`.
 */
import { TOOLS, type ToolInput, type ToolName, type ToolOutput } from '@junction/shared';
import { validateInput, type GatewayClient } from './gateway-client.js';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** A non-2xx answer, e.g. 403 UNKNOWN_AGENT, 422 OFFER_EXPIRED, 429 QUERY_BUDGET_EXCEEDED. */
export class GatewayHttpError extends Error {
  override name = 'GatewayHttpError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// a kitchen is waiting: a hung gateway must not hang the run
const TIMEOUT_MS = 15_000;

export class HttpGateway implements GatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  private async call<N extends ToolName>(name: N, input: ToolInput<N>): Promise<ToolOutput<N>> {
    validateInput(name, input);
    const { method, path } = TOOLS[name].http;
    const body: Record<string, unknown> = { ...(input as Record<string, unknown>) };
    const url = path.replace(/\{(\w+)\}/g, (_match, param: string) => {
      const value = String(body[param] ?? '');
      delete body[param];
      return encodeURIComponent(value);
    });
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, '')}${url}`, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await res.json().catch(() => undefined);
    if (!res.ok) {
      const error = (payload ?? {}) as { code?: unknown; message?: unknown };
      throw new GatewayHttpError(res.status, String(error.code ?? 'HTTP_ERROR'), `${name}: HTTP ${res.status} ${String(error.code ?? '')} ${String(error.message ?? '')}`.trim());
    }
    return payload as ToolOutput<N>;
  }

  search_products = (input: ToolInput<'search_products'>) => this.call('search_products', input);
  get_offers = (input: ToolInput<'get_offers'>) => this.call('get_offers', input);
  propose_order = (input: ToolInput<'propose_order'>) => this.call('propose_order', input);
  approve_order = (input: ToolInput<'approve_order'>) => this.call('approve_order', input);
  reject_order = (input: ToolInput<'reject_order'>) => this.call('reject_order', input);
  get_order = (input: ToolInput<'get_order'>) => this.call('get_order', input);
  explain = (input: ToolInput<'explain'>) => this.call('explain', input);
}
