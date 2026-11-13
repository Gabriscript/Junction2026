import type { AuditEvent, AuditScope, Order } from './contract';
import { GENESIS_HASH, hashEvent } from './hash';
import { eventsForOrder, hospitalOrder, hotelOrder, rogueOrder, type SeedEvent } from './mockData';

export interface GatewayApi {
  listOrders(): Promise<Order[]>;
  getOrder(orderId: string): Promise<Order>;
  approve(orderId: string, approver: string): Promise<Order>;
  reject(orderId: string, approver: string, reason: string): Promise<Order>;
  /** Events in ascending seq order. */
  listAuditEvents(scope: AuditScope): Promise<AuditEvent[]>;
  /** Calls back for every new audit event. Returns an unsubscribe function. */
  subscribe(onEvent: (event: AuditEvent) => void): () => void;
  submitRequest(text: string): Promise<Order>;
}

/** REST + SSE client. The paths are the contract documented in README.md. */
export class HttpGatewayApi implements GatewayApi {
  private readonly base: string;

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gateway answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    return (await res.json()) as T;
  }

  listOrders() {
    return this.call<Order[]>('/api/orders');
  }
  getOrder(orderId: string) {
    return this.call<Order>(`/api/orders/${encodeURIComponent(orderId)}`);
  }
  approve(orderId: string, approver: string) {
    return this.call<Order>(`/api/orders/${encodeURIComponent(orderId)}/approve`, { approver });
  }
  reject(orderId: string, approver: string, reason: string) {
    return this.call<Order>(`/api/orders/${encodeURIComponent(orderId)}/reject`, { approver, reason });
  }
  listAuditEvents(scope: AuditScope) {
    return this.call<AuditEvent[]>(`/api/audit?scope=${scope}`);
  }
  submitRequest(text: string) {
    return this.call<Order>('/api/requests', { text });
  }

  subscribe(onEvent: (event: AuditEvent) => void) {
    const source = new EventSource(`${this.base}/api/events`);
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data) as AuditEvent);
      } catch {
        // A malformed frame must not kill the stream; the next event triggers a refetch anyway.
      }
    };
    return () => source.close();
  }
}

/** In-memory gateway seeded with the demo scenes. Used when VITE_GATEWAY_URL is unset. */
export class MockGatewayApi implements GatewayApi {
  private orders: Order[] = structuredClone([hotelOrder, hospitalOrder, rogueOrder]);
  private events: AuditEvent[] = [];
  private listeners = new Set<(event: AuditEvent) => void>();
  /** Serialises appends: each hash needs the previous one. */
  private tail: Promise<void> = Promise.resolve();
  private nextOrder = 1004;

  constructor() {
    for (const order of this.orders) for (const e of eventsForOrder(order)) this.append(e);
  }

  private append(seed: SeedEvent): Promise<void> {
    this.tail = this.tail.then(async () => {
      const prevHash = this.events.at(-1)?.hash ?? GENESIS_HASH;
      const body = { ...seed, seq: this.events.length + 1, prevHash };
      const event: AuditEvent = { ...body, hash: await hashEvent(body) };
      this.events.push(event);
      for (const listener of this.listeners) listener(structuredClone(event));
    });
    return this.tail;
  }

  private find(orderId: string): Order {
    const order = this.orders.find((o) => o.orderId === orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    return order;
  }

  private async review(orderId: string, action: 'approved' | 'rejected', approver: string, reason?: string) {
    const order = this.find(orderId);
    if (order.status !== 'needs_approval') throw new Error(`Order ${orderId} is not waiting for approval`);
    order.status = action;
    order.review = { action, approver, at: new Date().toISOString(), ...(reason ? { reason } : {}) };
    await this.append({
      ts: order.review.at,
      actor: 'human',
      kind: `order_${action}`,
      orderId,
      summary: `Order ${orderId} ${action} by ${approver}${reason ? `: ${reason}` : ''}`,
      details: { agentId: order.agentId, buyer: order.buyer, mandateId: order.mandateId, approver, ...(reason ? { reason } : {}) },
    });
    return structuredClone(order);
  }

  async listOrders() {
    await this.tail;
    return structuredClone(this.orders);
  }
  async getOrder(orderId: string) {
    await this.tail;
    return structuredClone(this.find(orderId));
  }
  approve(orderId: string, approver: string) {
    return this.review(orderId, 'approved', approver);
  }
  reject(orderId: string, approver: string, reason: string) {
    return this.review(orderId, 'rejected', approver, reason);
  }

  async listAuditEvents(scope: AuditScope) {
    await this.tail;
    // Buyer scope = events made under a buyer mandate. A real gateway scopes by the signed-in buyer.
    const visible = scope === 'aimo' ? this.events : this.events.filter((e) => e.details.mandateId);
    return structuredClone(visible);
  }

  subscribe(onEvent: (event: AuditEvent) => void) {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }

  // shortcut: no agent behind the mock, so a request reuses a demo cart (milk = auto-approved,
  // anything else = needs approval). The real gateway + agent replace this.
  async submitRequest(text: string) {
    const template = /milk/i.test(text) ? hotelOrder : hospitalOrder;
    const order: Order = {
      ...structuredClone(template),
      orderId: `ord-${this.nextOrder++}`,
      requestText: text,
      createdAt: new Date().toISOString(),
    };
    this.orders.push(order);
    for (const e of eventsForOrder(order)) void this.append(e);
    await this.tail;
    return structuredClone(order);
  }

  /** Demo and test hook: edits a stored event without re-hashing it, as an attacker with database access would. */
  async tamper(seq: number) {
    await this.tail;
    const event = this.events.find((e) => e.seq === seq);
    if (!event) throw new Error(`Event ${seq} not found`);
    event.summary = `${event.summary} (edited after the fact)`;
    for (const listener of this.listeners) listener(structuredClone(event));
  }
}

export function createApi(): GatewayApi {
  const url = import.meta.env.VITE_GATEWAY_URL as string | undefined;
  return url ? new HttpGatewayApi(url) : new MockGatewayApi();
}
