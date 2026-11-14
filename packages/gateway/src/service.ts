/**
 * The 7 gateway tools, implemented once. REST (http/) and MCP (mcp/) are thin bindings over this.
 *
 * Every money- or trust-relevant step appends to the hash-chained audit log.
 */
import { randomUUID } from 'node:crypto';
import {
  GetOffersInputSchema,
  OfferSchema,
  ProposeOrderInputSchema,
  REASON_CODE_INFO,
  roundEur,
  SearchProductsInputSchema,
  totalsFromNet,
  type ApproveOrderInput,
  type Explanation,
  type GetOffersInput,
  type GetOffersOutput,
  type Offer,
  type Order,
  type ProposeOrderInput,
  type RejectOrderInput,
  type SearchProductsInput,
  type SearchProductsOutput,
  type SignedOffer,
} from '@junction/shared';
import type { AimoClient, AvailabilityProduct, PriceProduct } from './aimo/client.js';
import type { AuditStore } from './audit/store.js';
import type { Catalogue } from './catalogue/store.js';
import type { GatewayConfig, KnownAgent } from './config.js';
import type { OrderStore } from './orders/store.js';
import { evaluate, type VerifiedLine } from './policy/evaluate.js';
import type { SigningKey } from './trust/keys.js';
import { signOffer, verifyOfferJws } from './trust/offers.js';

export class GatewayError extends Error {
  override name = 'GatewayError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface GatewayDeps {
  catalogue: Catalogue;
  aimo: AimoClient;
  key: SigningKey;
  audit: AuditStore;
  orders: OrderStore;
  config: GatewayConfig;
  now?: () => Date;
}

const GATEWAY_ACTOR = { type: 'gateway', id: 'gateway', name: 'Valio Aimo gateway' } as const;

/** Normalise Aimo timestamps (`+0200`) to RFC 3339 (`+02:00`). */
export function normaliseInstant(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(.*T\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(\d{2})$/.exec(s);
  const iso = m ? `${m[1]}${m[2]}:${m[3]}` : s;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export class GatewayService {
  private readonly now: () => Date;
  /** Per-agent sliding-hour query log: timestamps of shortlist items looked up. */
  private readonly queries = new Map<string, number[]>();

  constructor(private readonly deps: GatewayDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get jwksUrl(): string {
    return `${this.deps.config.publicUrl}/.well-known/jwks.json`;
  }

  knownAgent(agentId: string): KnownAgent | undefined {
    return this.deps.config.knownAgents.find((a) => a.agentId === agentId);
  }

  // ------------------------------------------------------------------ search_products
  searchProducts(input: SearchProductsInput): SearchProductsOutput {
    return this.deps.catalogue.search(SearchProductsInputSchema.parse(input));
  }

  // ------------------------------------------------------------------ get_offers
  private chargeQueryBudget(agent: KnownAgent, items: number): boolean {
    const t = this.now().getTime();
    const log = (this.queries.get(agent.agentId) ?? []).filter((x) => x > t - 3_600_000);
    for (let i = 0; i < items; i++) log.push(t);
    this.queries.set(agent.agentId, log);
    return log.length > agent.queryBudgetPerHour;
  }

  isOverQueryBudget(agentId: string): boolean {
    const agent = this.knownAgent(agentId);
    if (!agent) return false;
    const t = this.now().getTime();
    return (this.queries.get(agentId) ?? []).filter((x) => x > t - 3_600_000).length > agent.queryBudgetPerHour;
  }

  async getOffers(rawInput: GetOffersInput): Promise<GetOffersOutput> {
    const input = GetOffersInputSchema.parse(rawInput);
    const agent = this.knownAgent(input.agentId);
    if (!agent || !agent.customerRefs.includes(input.customerRef)) {
      this.deps.audit.append({
        type: 'agent_rejected',
        actor: GATEWAY_ACTOR,
        orderId: null,
        agentId: input.agentId,
        customerRef: null,
        reasonCodes: ['UNKNOWN_AGENT'],
        summary: `Rejected get_offers from ${agent ? 'agent not registered for customer ' + input.customerRef : 'unknown agent'} ${input.agentId}`,
        data: { customerRef: input.customerRef, items: input.items.length },
        visibility: ['aimo'],
      });
      throw new GatewayError(403, 'UNKNOWN_AGENT', REASON_CODE_INFO.UNKNOWN_AGENT.description);
    }
    if (this.chargeQueryBudget(agent, input.items.length)) {
      this.deps.audit.append({
        type: 'query_budget_exceeded',
        actor: GATEWAY_ACTOR,
        orderId: null,
        agentId: input.agentId,
        customerRef: input.customerRef,
        reasonCodes: ['QUERY_BUDGET_EXCEEDED'],
        summary: `${input.agentId} exceeded ${agent.queryBudgetPerHour} shortlist lookups per hour`,
        data: { items: input.items.length, budgetPerHour: agent.queryBudgetPerHour },
        visibility: ['aimo'],
      });
      throw new GatewayError(429, 'QUERY_BUDGET_EXCEEDED', REASON_CODE_INFO.QUERY_BUDGET_EXCEEDED.description);
    }

    const ids = input.items.map((i) => i.productId);
    const products = this.deps.catalogue.getMany(ids);
    const unavailable: GetOffersOutput['unavailable'] = [];
    const known = input.items.filter((i) => {
      if (products.has(i.productId)) return true;
      unavailable.push({ productId: i.productId, reason: 'UNKNOWN_PRODUCT' });
      return false;
    });

    const offers: SignedOffer[] = [];
    if (known.length > 0) {
      const q = { productIds: known.map((i) => i.productId), requestedDate: input.requestedDate, customer: input.customerRef };
      const [price, avail] = await Promise.all([this.deps.aimo.price(q), this.deps.aimo.availability(q)]);
      const issuedAt = this.now();
      const validUntil = new Date(issuedAt.getTime() + this.deps.config.offerTtlMinutes * 60_000);
      for (const item of known) {
        const p = price.byId.get(item.productId);
        const a = avail.byId.get(item.productId);
        if (!p || price.unknownIds.includes(item.productId)) {
          unavailable.push({ productId: item.productId, reason: 'NO_PRICE' }); // in our catalogue, but Aimo has no price
          continue;
        }
        if (!a || a.scheduleLines.length === 0) {
          unavailable.push({ productId: item.productId, reason: 'NOT_DELIVERABLE' });
          continue;
        }
        const offer = this.buildOffer(input, item, products.get(item.productId)!, p, a, issuedAt, validUntil);
        offers.push(await signOffer(offer, this.deps.key));
      }
    }

    this.deps.audit.append({
      type: 'offers_issued',
      actor: GATEWAY_ACTOR,
      orderId: null,
      agentId: input.agentId,
      customerRef: input.customerRef,
      reasonCodes: [],
      summary: `Issued ${offers.length} signed offer${offers.length === 1 ? '' : 's'} to ${input.agentId}${unavailable.length ? ` (${unavailable.length} unavailable)` : ''}`,
      data: {
        offerIds: offers.map((o) => o.offer.offerId),
        productIds: offers.map((o) => o.offer.productId),
        unavailable,
        requestedDate: input.requestedDate,
        validUntil: offers[0]?.offer.validUntil ?? null,
      },
      visibility: ['buyer', 'aimo'],
    });
    return { offers, unavailable, jwksUrl: this.jwksUrl };
  }

  private buildOffer(
    input: GetOffersInput,
    item: { productId: string; quantity: number },
    product: NonNullable<ReturnType<Catalogue['getById']>>,
    p: PriceProduct,
    a: AvailabilityProduct,
    issuedAt: Date,
    validUntil: Date,
  ): Offer {
    const line = a.scheduleLines[0]!;
    const unitPrice = roundEur(p.catalogPrice!.value);
    const vatRate = p.tax!.taxRate;
    const logisticModel = a.logisticModel === 'Stock' || a.logisticModel === 'Terminal' ? a.logisticModel : null;
    const comparison: Offer['comparisonPrice'] =
      p.comparisonPrice && (p.comparisonUnit === 'L' || p.comparisonUnit === 'KG')
        ? { value: roundEur(p.comparisonPrice.value), unit: p.comparisonUnit === 'L' ? 'L' : 'KG' }
        : null;
    const priceValidFrom = normaliseInstant(p.catalogPrice?.validFrom);
    const priceValidTo = normaliseInstant(p.catalogPrice?.validTo);
    // The offer is valid for the TTL, but never beyond Aimo's own price validity window.
    const until = priceValidTo && Date.parse(priceValidTo) < validUntil.getTime() ? new Date(priceValidTo) : validUntil;
    const offer: Offer = {
      offerId: `off_${randomUUID()}`,
      productId: item.productId,
      productName: product.name,
      customerRef: input.customerRef,
      requestedDate: input.requestedDate,
      quantity: item.quantity,
      unit: product.pack.salesUnit,
      unitPrice,
      currency: 'EUR',
      vatRate,
      totals: totalsFromNet(item.quantity * unitPrice, vatRate),
      comparisonPrice: comparison,
      netPriceFound: p.netPriceFound === true,
      availableQuantity: typeof line.availableAmount === 'number' ? line.availableAmount : null,
      quantityVerified: logisticModel === 'Stock',
      logisticModel,
      availableDate: line.availableDate && /^\d{4}-\d{2}-\d{2}$/.test(line.availableDate) ? line.availableDate : null,
      cutoffTime: normaliseInstant(a.closingTime),
      salesBlock: a.salesBlock === true || line.salesBlock === true,
      origin: product.originCountry,
      labels: product.labels,
      validFrom: priceValidFrom && Date.parse(priceValidFrom) > issuedAt.getTime() ? priceValidFrom : issuedAt.toISOString(),
      validUntil: until.toISOString(),
      issuer: this.jwksUrl,
      issuedAt: issuedAt.toISOString(),
    };
    return OfferSchema.parse(offer);
  }

  // ------------------------------------------------------------------ propose_order
  async proposeOrder(rawInput: ProposeOrderInput): Promise<Order> {
    const proposal = ProposeOrderInputSchema.parse(rawInput);
    const now = this.now();
    const orderId = `ord_${randomUUID()}`;
    const agentActor = { type: 'agent', id: proposal.agentId } as const;

    const lines: VerifiedLine[] = [];
    for (const [i, pl] of proposal.lines.entries()) {
      const verification = await verifyOfferJws(pl.offerJws, this.deps.key, { now });
      lines.push({ lineId: `ln_${i + 1}`, proposal: pl, verification });
    }
    const productIds = lines.flatMap((l) => (l.verification.ok ? [l.verification.offer.productId] : [])).concat(
      proposal.lines.flatMap((l) => (l.substituteFor ? [l.substituteFor] : [])),
    );
    const products = this.deps.catalogue.getMany(productIds);

    const result = evaluate({
      proposal,
      lines,
      products,
      knownAgents: this.deps.config.knownAgents,
      spentGross: this.deps.orders.spentGross(proposal.mandate.mandateId),
      queryBudgetExceeded: this.isOverQueryBudget(proposal.agentId),
      now,
      policyVersion: this.deps.config.policyVersion,
    });

    this.deps.audit.append({
      type: 'order_proposed',
      actor: agentActor,
      orderId,
      agentId: proposal.agentId,
      customerRef: proposal.mandate.customerRef,
      reasonCodes: [],
      summary: `${proposal.agentId} proposed ${orderId} (${proposal.lines.length} line${proposal.lines.length === 1 ? '' : 's'})`,
      data: { offerIds: proposal.lines.map((l) => l.offerId), mandateId: proposal.mandate.mandateId, neededBy: proposal.neededBy, requestText: proposal.requestText ?? null },
      visibility: ['buyer', 'aimo'],
    });

    // Lines whose offer failed verification are not orderable: no price to commit to.
    if (result.lines.length === 0) {
      const codes = result.decision.reasonCodes;
      const unknownAgent = codes.includes('UNKNOWN_AGENT');
      this.deps.audit.append({
        type: unknownAgent ? 'agent_rejected' : 'offer_rejected',
        actor: GATEWAY_ACTOR,
        orderId,
        agentId: proposal.agentId,
        customerRef: unknownAgent ? null : proposal.mandate.customerRef,
        reasonCodes: codes,
        summary: `Rejected proposal ${orderId} from ${proposal.agentId}: ${codes.join(', ')}`,
        data: { reasons: result.decision.reasons },
        visibility: unknownAgent ? ['aimo'] : ['buyer', 'aimo'],
      });
      throw new GatewayError(422, codes[0] ?? 'INVALID_PROPOSAL', `No orderable line: ${result.decision.reasons.map((r) => r.message).join(' ')}`);
    }

    const status: Order['status'] =
      result.decision.status === 'auto_approved' ? 'auto_approved' : result.decision.status === 'blocked' ? 'blocked' : 'pending_approval';
    const order: Order = {
      orderId,
      agentId: proposal.agentId,
      mandateId: proposal.mandate.mandateId,
      customerRef: proposal.mandate.customerRef,
      buyerName: proposal.mandate.buyer.name,
      status,
      lines: result.lines,
      totals: result.totals,
      neededBy: proposal.neededBy,
      ...(proposal.requestText ? { requestText: proposal.requestText } : {}),
      ...(proposal.rationale ? { rationale: proposal.rationale } : {}),
      decision: result.decision,
      approval: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.deps.orders.save(order);
    this.deps.audit.append({
      type: 'order_decided',
      actor: GATEWAY_ACTOR,
      orderId,
      agentId: proposal.agentId,
      customerRef: order.customerRef,
      reasonCodes: result.decision.reasonCodes,
      summary: `${orderId} ${status.replace('_', ' ')}${result.decision.reasonCodes.length ? ': ' + result.decision.reasonCodes.join(', ') : ''} (${eur(order.totals.gross)} incl. VAT)`,
      data: { status, totals: order.totals, reasons: result.decision.reasons, policyVersion: result.decision.policyVersion },
      visibility: ['buyer', 'aimo'],
    });
    return order;
  }

  // ------------------------------------------------------------------ approve / reject / get
  listOrders(filter: { customerRef?: string; status?: Order['status'] } = {}): Order[] {
    return this.deps.orders.list(filter);
  }

  getOrder(orderId: string): Order {
    const order = this.deps.orders.get(orderId);
    if (!order) throw new GatewayError(404, 'ORDER_NOT_FOUND', `Order ${orderId} not found`);
    return order;
  }

  approveOrder(input: ApproveOrderInput): Order {
    return this.decide(input.orderId, 'approved', input.approver, input.comment);
  }

  rejectOrder(input: RejectOrderInput): Order {
    return this.decide(input.orderId, 'rejected', input.approver, input.comment);
  }

  private decide(orderId: string, outcome: 'approved' | 'rejected', by: ApproveOrderInput['approver'], comment?: string): Order {
    const order = this.getOrder(orderId);
    if (by.type !== 'human') throw new GatewayError(403, 'HUMAN_ONLY', 'Only a human approver can approve or reject');
    if (order.status !== 'pending_approval') {
      throw new GatewayError(409, 'NOT_PENDING', `Order ${orderId} is ${order.status}, only pending_approval orders can be ${outcome}`);
    }
    const at = this.now().toISOString();
    const updated: Order = {
      ...order,
      status: outcome,
      approval: { outcome, by, at, ...(comment ? { comment } : {}) },
      updatedAt: at,
    };
    this.deps.orders.save(updated);
    this.deps.audit.append({
      type: outcome === 'approved' ? 'order_approved' : 'order_rejected',
      actor: by,
      orderId,
      agentId: order.agentId,
      customerRef: order.customerRef,
      reasonCodes: order.decision.reasonCodes,
      summary: `${by.name ?? by.id} ${outcome} ${orderId}${comment ? `: "${comment}"` : ''}`,
      data: { comment: comment ?? null, totals: order.totals },
      visibility: ['buyer', 'aimo'],
    });
    return updated;
  }

  // ------------------------------------------------------------------ explain
  explain(orderId: string): Explanation {
    const order = this.getOrder(orderId);
    const reasons = order.decision.reasons.map((r) => ({
      code: r.code,
      severity: r.severity,
      source: REASON_CODE_INFO[r.code].source,
      title: REASON_CODE_INFO[r.code].title,
      message: r.message,
      ...(r.lineId ? { lineId: r.lineId } : {}),
    }));
    const blocked = reasons.filter((r) => r.severity === 'blocked');
    let headline: string;
    const nextSteps: string[] = [];
    switch (order.status) {
      case 'auto_approved':
        headline = `Auto-approved: ${eur(order.totals.gross)} incl. VAT is within the mandate, every line is verified and deliverable by ${order.neededBy}.`;
        nextSteps.push('Nothing to do — the order is placed at the signed prices.');
        break;
      case 'pending_approval':
        headline = `Needs approval: ${reasons.map((r) => r.message).join(' ')}`;
        nextSteps.push('Approve or reject in the approval app', 'Or ask the agent for an alternative that avoids these reasons');
        break;
      case 'approved':
        headline = `Approved by ${order.approval?.by.name ?? order.approval?.by.id ?? 'a human'} at ${order.approval?.at ?? order.updatedAt}.`;
        nextSteps.push('Nothing to do — the order is placed at the signed prices.');
        break;
      case 'rejected':
        headline = `Rejected by ${order.approval?.by.name ?? order.approval?.by.id ?? 'a human'}${order.approval?.comment ? `: "${order.approval.comment}"` : '.'}`;
        nextSteps.push('The agent should re-plan using the rejection comment');
        break;
      case 'blocked':
        headline = `Blocked: ${blocked.map((r) => r.message).join(' ')}`;
        for (const r of blocked) {
          if (r.code === 'ALLERGEN_CONFLICT') nextSteps.push('Choose a product with explicit allergen data that is free from the forbidden allergens');
          if (r.code === 'OFFER_EXPIRED' || r.code === 'OFFER_SIGNATURE_INVALID') nextSteps.push('Fetch fresh offers with get_offers and resubmit');
          if (r.code === 'MANDATE_EXPIRED') nextSteps.push('Ask the buyer to issue a new mandate');
          if (r.code === 'UNKNOWN_AGENT') nextSteps.push('Register the agent with Valio Aimo for this customer');
          if (r.code === 'SALES_BLOCK') nextSteps.push('Pick another product; Valio Aimo is not selling this one right now');
          if (r.code === 'QUERY_BUDGET_EXCEEDED') nextSteps.push('Wait for the query budget window to pass and narrow the shortlist');
          if (r.code === 'OVER_BUDGET') nextSteps.push('Ask the buyer to raise the mandate budget');
        }
        break;
    }
    return {
      orderId,
      status: order.status,
      headline,
      reasons,
      nextSteps: [...new Set(nextSteps)],
      timeline: this.deps.audit.forOrder(orderId),
    };
  }
}

function eur(n: number): string {
  return `€${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
