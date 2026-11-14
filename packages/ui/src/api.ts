import {
  AuditEventSchema,
  GENESIS_HASH,
  OrderSchema,
  TOOLS,
  type Actor,
  type AuditEvent,
  type ToolInput,
  type ToolName,
} from '@junction/shared';
import type { AuditScope, UiOrder } from './contract';
import { hashEvent } from './hash';
import { auroraOrder, eventsForOrder, hospitalOrder, hotelOrder, rogueOrder, weekOrder, type SeedEvent } from './mockData';
import type { WeekOrder } from './kitchen';

export interface GatewayApi {
  listOrders(): Promise<UiOrder[]>;
  getOrder(orderId: string): Promise<UiOrder>;
  approve(orderId: string, approver: Actor): Promise<UiOrder>;
  reject(orderId: string, approver: Actor, comment: string): Promise<UiOrder>;
  /** Events in ascending seq order. */
  listAuditEvents(scope: AuditScope): Promise<AuditEvent[]>;
  /** Calls back for every new audit event. Returns an unsubscribe function. */
  subscribe(onEvent: (event: AuditEvent) => void): () => void;
  submitRequest(text: string): Promise<UiOrder>;
  /** The week's order after the chef confirmed it in the chat; `text` is the read-back the agent works from. */
  submitWeek(lines: WeekOrder[], text: string): Promise<UiOrder>;
}

/** REST path of a registry tool, with `{param}` placeholders filled from the input. */
export function toolPath(tool: ToolName, input: Record<string, unknown>): string {
  return TOOLS[tool].http.path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(String(input[name])));
}

/** REST + SSE client. Tool routes come from the shared registry; the rest is documented in README.md. */
export class HttpGatewayApi implements GatewayApi {
  private readonly base: string;

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(this.base + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gateway answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    return res.json();
  }

  /** Calls a registry tool: method and path from TOOLS, the whole input as the body of a POST. */
  private async tool<N extends 'get_order' | 'approve_order' | 'reject_order'>(name: N, input: ToolInput<N>): Promise<UiOrder> {
    const { method } = TOOLS[name].http;
    const json = await this.call(method, toolPath(name, input), method === 'POST' ? input : undefined);
    return TOOLS[name].output.parse(json).order;
  }

  // shortcut: list orders, audit, requests and the event stream are not in the shared tool registry yet,
  // so these paths stay hardcoded until shared defines them.
  async listOrders() {
    return OrderSchema.array().parse(await this.call('GET', '/api/orders'));
  }
  getOrder(orderId: string) {
    return this.tool('get_order', { orderId });
  }
  approve(orderId: string, approver: Actor) {
    return this.tool('approve_order', { orderId, approver: { ...approver, type: 'human' } });
  }
  reject(orderId: string, approver: Actor, comment: string) {
    return this.tool('reject_order', { orderId, approver: { ...approver, type: 'human' }, comment });
  }
  async listAuditEvents(scope: AuditScope) {
    return AuditEventSchema.array().parse(await this.call('GET', `/api/audit?scope=${scope}`));
  }
  async submitRequest(text: string) {
    return OrderSchema.parse(await this.call('POST', '/api/requests', { text }));
  }
  // The real agent parses the confirmed read-back itself, so the lines are not sent.
  submitWeek(_lines: WeekOrder[], text: string) {
    return this.submitRequest(text);
  }

  subscribe(onEvent: (event: AuditEvent) => void) {
    const source = new EventSource(`${this.base}/api/events`);
    source.onmessage = (message) => {
      try {
        onEvent(AuditEventSchema.parse(JSON.parse(message.data)));
      } catch {
        // A malformed frame must not kill the stream; the next event triggers a refetch anyway.
      }
    };
    return () => source.close();
  }
}

/** In-memory gateway seeded with the demo scenes. Used when VITE_GATEWAY_URL is unset. */
export class MockGatewayApi implements GatewayApi {
  private orders: UiOrder[] = structuredClone([auroraOrder, hotelOrder, hospitalOrder, rogueOrder]);
  private events: AuditEvent[] = [];
  private listeners = new Set<(event: AuditEvent) => void>();
  /** Serialises appends: each hash needs the previous one. */
  private tail: Promise<void> = Promise.resolve();
  private nextOrder = 1004;

  constructor() {
    for (const order of this.orders) {
      for (const e of eventsForOrder(order, order.orderId === rogueOrder.orderId ? ['aimo'] : undefined)) void this.append(e);
    }
  }

  private append(seed: SeedEvent): Promise<void> {
    this.tail = this.tail.then(async () => {
      const seq = this.events.length;
      const body = { ...seed, seq, eventId: `evt-${seq}`, prevHash: this.events.at(-1)?.hash ?? GENESIS_HASH };
      const event: AuditEvent = { ...body, hash: await hashEvent(body) };
      this.events.push(event);
      for (const listener of this.listeners) listener(structuredClone(event));
    });
    return this.tail;
  }

  private find(orderId: string): UiOrder {
    const order = this.orders.find((o) => o.orderId === orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    return order;
  }

  private async review(orderId: string, outcome: 'approved' | 'rejected', by: Actor, comment?: string) {
    const order = this.find(orderId);
    if (order.status !== 'pending_approval') throw new Error(`Order ${orderId} is not waiting for approval`);
    const at = new Date().toISOString();
    order.status = outcome;
    order.updatedAt = at;
    order.approval = { outcome, by, at, ...(comment ? { comment } : {}) };
    await this.append({
      at,
      type: `order_${outcome}`,
      actor: by,
      orderId,
      agentId: order.agentId,
      customerRef: order.customerRef,
      reasonCodes: [],
      summary: `Order ${orderId} ${outcome} by ${by.name ?? by.id}${comment ? `: ${comment}` : ''}`,
      data: { mandateId: order.mandateId, ...(comment ? { comment } : {}) },
      visibility: ['buyer', 'aimo'],
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
  approve(orderId: string, approver: Actor) {
    return this.review(orderId, 'approved', approver);
  }
  reject(orderId: string, approver: Actor, comment: string) {
    return this.review(orderId, 'rejected', approver, comment);
  }

  async listAuditEvents(scope: AuditScope) {
    await this.tail;
    // A real gateway also limits the buyer view to the signed-in buyer's customerRef.
    return structuredClone(this.events.filter((e) => e.visibility.includes(scope)));
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
    const now = new Date().toISOString();
    const order: UiOrder = {
      ...structuredClone(template),
      orderId: `ord-${this.nextOrder++}`,
      requestText: text,
      createdAt: now,
      updatedAt: now,
    };
    this.orders.push(order);
    for (const e of eventsForOrder(order)) void this.append(e);
    await this.tail;
    return structuredClone(order);
  }

  async submitWeek(lines: WeekOrder[], text: string) {
    const now = new Date().toISOString();
    const order = weekOrder(`ord-${this.nextOrder++}`, lines, text, now);
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
