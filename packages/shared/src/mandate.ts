/**
 * Buyer mandate: what a customer organisation authorises its AI purchasing agent to do.
 *
 * Issued by a human at the buyer (e.g. the hotel's purchasing manager) and presented by
 * the agent with every `propose_order`. The policy engine checks each proposal against it:
 * validity window → MANDATE_EXPIRED, agent id → UNKNOWN_AGENT, money → OVER_BUDGET /
 * OVER_AUTO_LIMIT, allergens → ALLERGEN_CONFLICT, substitutes → SUBSTITUTION_OUTSIDE_PREFS.
 *
 * v0.1: the mandate travels inline as plain JSON. Signing it by the buyer (JWS, like offers)
 * is a documented next step, not part of the prototype contract.
 */
import { z } from 'zod';
import {
  ActorSchema,
  EurAmountSchema,
  IdSchema,
  IsoDateTimeSchema,
} from './common.js';

/**
 * How far the agent may deviate from the products it was asked for:
 * - `none`          — only the exact products of the request; any substitute needs approval
 * - `aimo_listed`   — substitutes Valio Aimo lists for the product (`Product.substitutes`)
 * - `same_category` — any product in the same Aimo category that meets all hard constraints
 * - `any`           — any product meeting the hard constraints (allergens, attributes)
 * Hard constraints (allergens) are NEVER relaxed by this setting.
 */
export const SubstitutionPolicySchema = z
  .enum(['none', 'aimo_listed', 'same_category', 'any'])
  .describe('none | aimo_listed | same_category | any');
export type SubstitutionPolicy = z.infer<typeof SubstitutionPolicySchema>;

export const MandateSchema = z
  .object({
    /** Unique mandate id, chosen by the issuer. */
    mandateId: IdSchema.describe('Mandate id'),
    /** Aimo customer number the agent buys for. */
    customerRef: z.string().min(1).describe('Aimo customer reference'),
    /** Buyer organisation, for display and audit. */
    buyer: z
      .object({
        orgId: IdSchema.describe('Buyer organisation id'),
        name: z.string().min(1).describe('Buyer organisation name, e.g. "Hotel Aurora"'),
      })
      .describe('Buyer organisation'),
    /** The agent this mandate authorises (must match the calling agent and the static agent list). */
    agentId: IdSchema.describe('Authorised agent id, e.g. agent:hotel-buyer-1'),
    /** Human who issued the mandate; also the default approver for `needs_approval` orders. */
    issuedBy: ActorSchema.describe('Issuing human'),
    /** When the mandate was issued. */
    issuedAt: IsoDateTimeSchema,
    /** Start of validity. */
    validFrom: IsoDateTimeSchema,
    /** End of validity; after this, proposals are blocked with MANDATE_EXPIRED. */
    validUntil: IsoDateTimeSchema,
    /** Total spend allowed over the mandate's lifetime, EUR incl. VAT. Exceeding → OVER_BUDGET. */
    budgetLimit: EurAmountSchema.describe('Total budget over the mandate lifetime, EUR incl. VAT'),
    /** Largest single order the agent may place without a human, EUR incl. VAT. Above → OVER_AUTO_LIMIT. */
    autoApproveLimit: EurAmountSchema.describe('Max order total for auto-approval, EUR incl. VAT'),
    /**
     * GS1 allergen codes that must be ABSENT from every line (hard constraint).
     * A product passes only with an explicit FREE_FROM, or no CONTAINS/MAY_CONTAIN *and*
     * allergen data present — unknown data is unsafe → ALLERGEN_CONFLICT (blocked).
     */
    forbiddenAllergens: z.array(z.string().min(1).max(8)).describe('GS1 allergen codes that must be absent'),
    /** Dietary attributes every line must carry, e.g. `LACTOSE_FREE`. */
    requiredAttributes: z.array(z.string().min(1)).describe('Required attribute codes, e.g. LACTOSE_FREE'),
    /** Substitution freedom; see `SubstitutionPolicySchema`. */
    substitutionPolicy: SubstitutionPolicySchema,
    /** Optional allow-list of Aimo category codes; `null` = any category. */
    allowedCategories: z.array(z.string().min(1)).nullable().describe('Allowed category codes; null = any'),
  })
  .describe('Buyer mandate for an AI purchasing agent');
export type Mandate = z.infer<typeof MandateSchema>;
