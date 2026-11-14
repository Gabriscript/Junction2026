/**
 * The 7 gateway tools — input/output schemas and binding metadata.
 *
 * Defined once here and bound twice by the gateway: Fastify REST (OpenAPI generated from
 * these Zod schemas) and an MCP server. The agent and the mock gateway use the same
 * registry, so a schema change is a contract change (PR + both ✅).
 *
 * Field names are camelCase on the wire (REST and MCP alike).
 * `humanOnly` tools (approve/reject) are exposed over REST for the approval UI only —
 * never as MCP tools, so no agent can approve its own order.
 */
import { z } from 'zod';
import {
  ActorSchema,
  IdSchema,
  IsoDateSchema,
  ProductIdSchema,
} from './common.js';
import { AuditEventSchema } from './audit.js';
import { SignedOfferSchema } from './offer.js';
import { OrderProposalSchema, OrderSchema, OrderStatusSchema } from './order.js';
import { ProductSchema } from './product.js';
import { ReasonCodeSchema, ReasonSeveritySchema } from './reason-codes.js';

// ---------------------------------------------------------------- search_products

export const SearchProductsInputSchema = z
  .object({
    /** Free text matched against names (fi + en) via full-text search, e.g. "lactose free milk". */
    text: z.string().min(1).max(200).optional().describe('Free-text query'),
    /** Every listed attribute must be present, e.g. ["LACTOSE_FREE"]. */
    attributes: z.array(z.string().min(1)).default([]).describe('Required attribute codes'),
    /** GS1 allergen codes that must be absent (unknown allergen data is excluded). */
    freeFromAllergens: z.array(z.string().min(1).max(8)).default([]).describe('GS1 allergen codes to exclude'),
    /** Aimo category code filter. */
    category: z.string().min(1).optional().describe('Aimo category code'),
    /** Only products whose net content is measured in this unit (e.g. L for "1,000 L of milk"). */
    unit: z.enum(['L', 'KG', 'ST']).optional().describe('Net-content unit filter'),
    /** Max results, default 20. */
    limit: z.number().int().min(1).max(50).default(20).describe('Max results (1-50)'),
  })
  .describe('search_products input');
export type SearchProductsInput = z.input<typeof SearchProductsInputSchema>;

export const SearchProductsOutputSchema = z
  .object({
    products: z.array(ProductSchema),
    /** True when more products matched than `limit`. */
    truncated: z.boolean(),
  })
  .describe('search_products output');
export type SearchProductsOutput = z.infer<typeof SearchProductsOutputSchema>;

// ---------------------------------------------------------------- get_offers

export const GetOffersInputSchema = z
  .object({
    agentId: IdSchema.describe('Calling agent id'),
    customerRef: z.string().min(1).describe('Aimo customer reference'),
    /** Shortlist only (no catalogue polling). Quantity is in each product's sales unit. */
    items: z
      .array(
        z.object({
          productId: ProductIdSchema,
          quantity: z.number().positive().describe('Quantity in the product sales unit'),
        }),
      )
      .min(1)
      .max(50)
      .describe('Shortlisted products with quantities (max 50)'),
    /** Requested delivery date. */
    requestedDate: IsoDateSchema.describe('Requested delivery date'),
  })
  .describe('get_offers input');
export type GetOffersInput = z.input<typeof GetOffersInputSchema>;

export const OfferUnavailableReasonSchema = z
  .enum(['UNKNOWN_PRODUCT', 'NO_PRICE', 'NOT_DELIVERABLE'])
  .describe('Why no offer was issued');

export const GetOffersOutputSchema = z
  .object({
    offers: z.array(SignedOfferSchema),
    /** Shortlisted products for which no offer could be made. */
    unavailable: z.array(
      z.object({ productId: ProductIdSchema, reason: OfferUnavailableReasonSchema }),
    ),
    /** Where to fetch the verification keys, e.g. `http://localhost:8787/.well-known/jwks.json`. */
    jwksUrl: z.string().min(1).describe('JWKS URL for offer verification'),
  })
  .describe('get_offers output');
export type GetOffersOutput = z.infer<typeof GetOffersOutputSchema>;

// ---------------------------------------------------------------- propose_order

export const ProposeOrderInputSchema = OrderProposalSchema.describe('propose_order input');
export type ProposeOrderInput = z.input<typeof ProposeOrderInputSchema>;

export const OrderOutputSchema = z.object({ order: OrderSchema }).describe('Order envelope');
export type OrderOutput = z.infer<typeof OrderOutputSchema>;

// ---------------------------------------------------------------- approve / reject / get

const HumanActorSchema = ActorSchema.extend({ type: z.literal('human') }).describe('Human approver');

export const ApproveOrderInputSchema = z
  .object({
    orderId: IdSchema,
    approver: HumanActorSchema,
    comment: z.string().max(2000).optional(),
  })
  .describe('approve_order input');
export type ApproveOrderInput = z.input<typeof ApproveOrderInputSchema>;

export const RejectOrderInputSchema = z
  .object({
    orderId: IdSchema,
    approver: HumanActorSchema,
    /** Why the human rejected — fed back to the agent. */
    comment: z.string().min(1).max(2000).describe('Rejection reason'),
  })
  .describe('reject_order input');
export type RejectOrderInput = z.input<typeof RejectOrderInputSchema>;

export const GetOrderInputSchema = z.object({ orderId: IdSchema }).describe('get_order input');
export type GetOrderInput = z.input<typeof GetOrderInputSchema>;

// ---------------------------------------------------------------- explain

export const ExplainInputSchema = z.object({ orderId: IdSchema }).describe('explain input');
export type ExplainInput = z.input<typeof ExplainInputSchema>;

export const ExplanationSchema = z
  .object({
    orderId: IdSchema,
    status: OrderStatusSchema,
    /** One sentence, e.g. "Needs approval: total €1,290.50 is above the €1,000 auto-approve limit." */
    headline: z.string().min(1),
    reasons: z.array(
      z.object({
        code: ReasonCodeSchema,
        severity: ReasonSeveritySchema,
        source: z.enum(['mandate', 'aimo']),
        title: z.string().min(1),
        /** Case-specific message from the decision. */
        message: z.string().min(1),
        lineId: IdSchema.optional(),
      }),
    ),
    /** What the agent or a human can do next, e.g. "Fetch fresh offers", "Approve in the app". */
    nextSteps: z.array(z.string().min(1)),
    /** The order's audit trail (subset of the chain, in order). */
    timeline: z.array(AuditEventSchema),
  })
  .describe('Human-readable decision record');
export type Explanation = z.infer<typeof ExplanationSchema>;

// ---------------------------------------------------------------- registry

export const TOOL_NAMES = [
  'search_products',
  'get_offers',
  'propose_order',
  'approve_order',
  'reject_order',
  'get_order',
  'explain',
] as const;
export const ToolNameSchema = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolNameSchema>;

export interface ToolDefinition<
  N extends ToolName = ToolName,
  I extends z.ZodObject = z.ZodObject,
  O extends z.ZodType = z.ZodType,
> {
  name: N;
  /** Short title for MCP clients / docs. */
  title: string;
  /** Description an LLM reads to decide when to call the tool. */
  description: string;
  /** Always an object schema (MCP requires `inputSchema.type === "object"`). */
  input: I;
  output: O;
  /** REST binding. Path params use `{name}` and are taken from the input object. */
  http: { method: 'GET' | 'POST'; path: string };
  /** true = REST only, for the human approval UI; never exposed as an MCP tool. */
  humanOnly: boolean;
  /** true = changes state (orders, audit). */
  mutating: boolean;
}

function defineTool<const N extends ToolName, I extends z.ZodObject, O extends z.ZodType>(
  def: ToolDefinition<N, I, O>,
): ToolDefinition<N, I, O> {
  return def;
}

export const TOOLS = {
  search_products: defineTool({
    name: 'search_products',
    title: 'Search products',
    description:
      'Search the Valio Aimo catalogue (local index, no live calls). Filter by free text, dietary attributes ' +
      '(e.g. LACTOSE_FREE), allergens to exclude (GS1 codes, e.g. AM = milk) and net-content unit. ' +
      'Returns products with pack sizes, allergens, labels, reliability and CO2 — never prices.',
    input: SearchProductsInputSchema,
    output: SearchProductsOutputSchema,
    http: { method: 'POST', path: '/v1/products/search' },
    humanOnly: false,
    mutating: false,
  }),
  get_offers: defineTool({
    name: 'get_offers',
    title: 'Get signed offers',
    description:
      'Get live price and availability for a SHORTLIST of products (max 50) and receive fixed-price offers ' +
      'signed by Valio Aimo (JWS). Verify each offer against the JWKS before relying on it. Offers expire.',
    input: GetOffersInputSchema,
    output: GetOffersOutputSchema,
    http: { method: 'POST', path: '/v1/offers' },
    humanOnly: false,
    mutating: false,
  }),
  propose_order: defineTool({
    name: 'propose_order',
    title: 'Propose order',
    description:
      'Propose an order built from signed offers under a buyer mandate. Valio Aimo verifies the offers and ' +
      'returns a decision: auto_approved, needs_approval (a human decides in the app) or blocked, with reason codes.',
    input: ProposeOrderInputSchema,
    output: OrderOutputSchema,
    http: { method: 'POST', path: '/v1/orders' },
    humanOnly: false,
    mutating: true,
  }),
  approve_order: defineTool({
    name: 'approve_order',
    title: 'Approve order',
    description: 'Human approver accepts an order that needs approval. Not available to agents.',
    input: ApproveOrderInputSchema,
    output: OrderOutputSchema,
    http: { method: 'POST', path: '/v1/orders/{orderId}/approve' },
    humanOnly: true,
    mutating: true,
  }),
  reject_order: defineTool({
    name: 'reject_order',
    title: 'Reject order',
    description: 'Human approver rejects an order that needs approval, with a reason. Not available to agents.',
    input: RejectOrderInputSchema,
    output: OrderOutputSchema,
    http: { method: 'POST', path: '/v1/orders/{orderId}/reject' },
    humanOnly: true,
    mutating: true,
  }),
  get_order: defineTool({
    name: 'get_order',
    title: 'Get order',
    description: 'Get the current status, lines, totals and decision of an order.',
    input: GetOrderInputSchema,
    output: OrderOutputSchema,
    http: { method: 'GET', path: '/v1/orders/{orderId}' },
    humanOnly: false,
    mutating: false,
  }),
  explain: defineTool({
    name: 'explain',
    title: 'Explain decision',
    description:
      'Explain in plain language why an order was auto-approved, needs approval or was blocked, ' +
      'what can be done next, and its audit trail.',
    input: ExplainInputSchema,
    output: ExplanationSchema,
    http: { method: 'GET', path: '/v1/orders/{orderId}/explain' },
    humanOnly: false,
    mutating: false,
  }),
} as const satisfies { [K in ToolName]: ToolDefinition<K> };

export type Tools = typeof TOOLS;
export type ToolInput<N extends ToolName> = z.input<Tools[N]['input']>;
export type ToolOutput<N extends ToolName> = z.infer<Tools[N]['output']>;

/** All tools in registry order. */
export const TOOL_LIST: readonly ToolDefinition[] = TOOL_NAMES.map((n) => TOOLS[n]);

/** Tools an AI agent may call (exposed over MCP). */
export const AGENT_TOOLS: readonly ToolDefinition[] = TOOL_LIST.filter((t) => !t.humanOnly);
