/**
 * Order proposals, policy decisions and orders.
 *
 * Flow: the agent sends an `OrderProposal` (`propose_order`) → the gateway verifies every
 * offer JWS, evaluates the mandate + Aimo rules → `Decision` → stores an `Order`:
 *   - `auto_approved`  → order status `auto_approved` (placed, no human needed)
 *   - `needs_approval` → status `pending_approval`; a human calls approve/reject from the UI
 *   - `blocked`        → status `blocked`; nothing a human can do, agent must re-plan
 */
import { z } from 'zod';
import {
  ActorSchema,
  CompactJwsSchema,
  EurAmountSchema,
  IdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  ProductIdSchema,
  TotalsSchema,
  UnitCodeSchema,
  VatRatePercentSchema,
} from './common.js';
import { MandateSchema } from './mandate.js';
import {
  DecisionStatusSchema,
  ReasonCodeSchema,
  ReasonSeveritySchema,
} from './reason-codes.js';

/** One line of a proposal as the agent sends it: a signed offer + how much of it to buy. */
export const ProposalLineSchema = z
  .object({
    /** Offer id (must equal the `offerId` inside the JWS payload). */
    offerId: IdSchema.describe('Offer id'),
    /** The offer's compact JWS exactly as received from `get_offers`. Its payload is authoritative. */
    offerJws: CompactJwsSchema.describe('Offer JWS as received from get_offers'),
    /** Quantity in the offer's sales unit; must be a multiple of `allowedLotSize`. */
    quantity: z.number().positive().describe('Quantity in sales units'),
    /** Product this line replaces, when it is a substitute; `null` = the product that was asked for. */
    substituteFor: ProductIdSchema.nullable().describe('Original product id if this is a substitute'),
  })
  .describe('Proposal line');
export type ProposalLine = z.infer<typeof ProposalLineSchema>;

/** What an agent submits with `propose_order`. */
export const OrderProposalSchema = z
  .object({
    /** Calling agent; must match `mandate.agentId` and the gateway's static agent list. */
    agentId: IdSchema.describe('Calling agent id'),
    /** The buyer mandate the agent acts under. */
    mandate: MandateSchema,
    /** Lines to order (≥ 1). Several lines may split one need across SKUs (partial fill). */
    lines: z.array(ProposalLineSchema).min(1).describe('Order lines'),
    /** Date the buyer needs the goods, `YYYY-MM-DD`. Later delivery → DELIVERY_LATER_THAN_NEEDED. */
    neededBy: IsoDateSchema.describe('Date the goods are needed'),
    /** The original human request, for audit and the approver card (e.g. "1,000 L lactose-free milk by Monday"). */
    requestText: z.string().max(2000).optional().describe('Original free-text request'),
    /** Agent's short rationale for its choice (good-better-best), shown to the approver. */
    rationale: z.string().max(2000).optional().describe('Agent rationale shown to the approver'),
  })
  .describe('Order proposal from an agent');
export type OrderProposal = z.infer<typeof OrderProposalSchema>;

/** One reason in a decision: code + where it applies + a concrete, case-specific message. */
export const DecisionReasonSchema = z
  .object({
    code: ReasonCodeSchema,
    /** Effective severity (may be escalated from the default, never downgraded). */
    severity: ReasonSeveritySchema,
    /** Line the reason applies to; omitted for order-level reasons (e.g. OVER_BUDGET). */
    lineId: IdSchema.optional().describe('Affected line id; absent = whole order'),
    /** Concrete message, e.g. "Total €1,290.50 exceeds auto-approve limit €1,000.00". */
    message: z.string().min(1).describe('Case-specific explanation'),
  })
  .describe('Reason for a decision');
export type DecisionReason = z.infer<typeof DecisionReasonSchema>;

/** Output of the policy engine for one proposal. */
export const DecisionSchema = z
  .object({
    /** Derived from `reasons` via `decisionStatusFor` (any blocked → blocked; any → needs_approval; none → auto_approved). */
    status: DecisionStatusSchema,
    /** Distinct codes in `reasons`, in order of first appearance — convenient for badges/filters. */
    reasonCodes: z.array(ReasonCodeSchema).describe('Distinct reason codes'),
    /** Detailed reasons. Empty when `auto_approved`. */
    reasons: z.array(DecisionReasonSchema).describe('Detailed reasons'),
    /** When the policy engine decided. */
    decidedAt: IsoDateTimeSchema,
    /** Policy version that produced the decision, e.g. `policy-0.1`. */
    policyVersion: z.string().min(1).describe('Policy engine version'),
  })
  .describe('Policy decision');
export type Decision = z.infer<typeof DecisionSchema>;

/** A proposal line after verification: the signed offer's data, resolved for display and totals. */
export const OrderLineSchema = z
  .object({
    lineId: IdSchema.describe('Line id (gateway-generated)'),
    offerId: IdSchema,
    productId: ProductIdSchema,
    productName: z.string().min(1),
    quantity: z.number().positive().describe('Quantity in sales units'),
    unit: UnitCodeSchema,
    /** Unit price excl. VAT from the verified offer. */
    unitPrice: EurAmountSchema.describe('Unit price excl. VAT from the signed offer'),
    vatRate: VatRatePercentSchema,
    /** `quantity × unitPrice` with VAT. */
    totals: TotalsSchema,
    /** Earliest delivery date from the offer; `null` = not deliverable. */
    availableDate: IsoDateSchema.nullable(),
    substituteFor: ProductIdSchema.nullable(),
    /** Whether the offer JWS verified against the gateway key. Unverified lines are never placed. */
    offerVerified: z.boolean().describe('Offer signature verified'),
  })
  .describe('Resolved order line');
export type OrderLine = z.infer<typeof OrderLineSchema>;

/** Lifecycle status of an order. */
export const OrderStatusSchema = z
  .enum(['auto_approved', 'pending_approval', 'approved', 'rejected', 'blocked'])
  .describe('auto_approved | pending_approval | approved | rejected | blocked');
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** Human decision on a `pending_approval` order. */
export const ApprovalSchema = z
  .object({
    outcome: z.enum(['approved', 'rejected']),
    /** Must be a human actor. */
    by: ActorSchema,
    at: IsoDateTimeSchema,
    /** Optional note (required for rejections at the tool level). */
    comment: z.string().max(2000).optional(),
  })
  .describe('Human approval or rejection');
export type Approval = z.infer<typeof ApprovalSchema>;

export const OrderSchema = z
  .object({
    orderId: IdSchema.describe('Order id (gateway-generated)'),
    agentId: IdSchema,
    mandateId: IdSchema,
    customerRef: z.string().min(1),
    buyerName: z.string().min(1).describe('Buyer organisation name'),
    status: OrderStatusSchema,
    lines: z.array(OrderLineSchema).min(1),
    /** Sum over lines. */
    totals: TotalsSchema,
    neededBy: IsoDateSchema,
    requestText: z.string().optional(),
    rationale: z.string().optional(),
    decision: DecisionSchema,
    /** Present once a human approved or rejected. */
    approval: ApprovalSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .describe('Order with its policy decision');
export type Order = z.infer<typeof OrderSchema>;
