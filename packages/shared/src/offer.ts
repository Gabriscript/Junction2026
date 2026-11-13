/**
 * Signed fixed-price offers.
 *
 * `get_offers` turns live price + availability (Aimo mock API) into an `Offer` per
 * product and signs it as a JWS (gateway `src/trust/`). An order is accepted only if
 * every line references an offer whose signature verifies and whose `validUntil`
 * is in the future — that is the "fixed price" guarantee on both sides.
 *
 * Signing: `jws` is a compact JWS (alg `ES256`, header `kid` = key id published at
 * `/.well-known/jwks.json`) whose payload is `canonicalJson(offer)` (see common.ts).
 * Verifiers MUST re-canonicalise the `offer` object and compare bytes; the `offer`
 * field is a convenience copy for humans/UIs, the JWS payload is authoritative.
 */
import { z } from 'zod';
import {
  CompactJwsSchema,
  CountryCodeSchema,
  CurrencySchema,
  EurAmountSchema,
  IdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  LogisticModelSchema,
  ProductIdSchema,
  TotalsSchema,
  UnitCodeSchema,
  VatRatePercentSchema,
  ComparisonUnitSchema,
} from './common.js';

export const OfferSchema = z
  .object({
    /** Unique offer id (gateway-generated). Referenced by order lines. */
    offerId: IdSchema.describe('Offer id'),
    /** Aimo product code the offer is for. */
    productId: ProductIdSchema,
    /** Product display name, copied for human readability (not needed for verification). */
    productName: z.string().min(1).describe('Product name'),
    /** Aimo customer number the price was quoted for (the mock ignores it; real prices are customer-specific). */
    customerRef: z.string().min(1).describe('Aimo customer reference'),
    /** Delivery date the agent asked for (the `requestedDate` sent to the Aimo API), `YYYY-MM-DD`. */
    requestedDate: IsoDateSchema.describe('Requested delivery date'),
    /** Quantity quoted, in `unit` (sales units, e.g. 100 crates). */
    quantity: z.number().positive().describe('Quoted quantity in sales units'),
    /** Sales unit of `quantity` and `unitPrice`, e.g. `KI`. */
    unit: UnitCodeSchema.describe('Sales unit of quantity and unitPrice'),
    /** Price per ONE sales unit excluding VAT, EUR (Aimo `catalogPrice.value`, or net price when found). */
    unitPrice: EurAmountSchema.describe('Price per sales unit excl. VAT, EUR'),
    /** Always EUR. */
    currency: CurrencySchema,
    /** VAT rate in percent (Aimo `tax.taxRate`), e.g. 13.5 for food. */
    vatRate: VatRatePercentSchema.describe('VAT rate in percent'),
    /** Totals for `quantity × unitPrice`: net, vat, gross — all EUR. */
    totals: TotalsSchema,
    /** Price per comparison unit excl. VAT (Aimo `comparisonPrice.value`), e.g. €/L; `null` when Aimo has none. */
    comparisonPrice: z
      .object({
        value: EurAmountSchema.describe('EUR per comparison unit, excl. VAT'),
        unit: ComparisonUnitSchema,
      })
      .nullable()
      .describe('Comparison price per L/KG; null = none'),
    /** Whether a customer-specific net price was found (`netPriceFound`); false → catalogue price used. */
    netPriceFound: z.boolean().describe('Customer net price used (true) or catalogue price (false)'),
    /**
     * Quantity Aimo reports as available on `availableDate`, in `unit`.
     * For Terminal logistics Aimo returns a placeholder (999999) — see `quantityVerified`.
     * `null` when no schedule line exists (cannot be delivered currently).
     */
    availableQuantity: z
      .number()
      .nonnegative()
      .nullable()
      .describe('Available quantity in sales units; null = not deliverable'),
    /**
     * `true` only for `Stock` logistics (Valio Aimo warehouse, real count).
     * `false` for `Terminal` (supplier ship-through, quantity unknown) → policy raises UNVERIFIED_STOCK.
     */
    quantityVerified: z.boolean().describe('true = Stock (verified); false = Terminal (unverified)'),
    /** Aimo logistic model; `null` when the availability API returned none. */
    logisticModel: LogisticModelSchema.nullable(),
    /** Earliest date Aimo can deliver, `YYYY-MM-DD`; may be later than `requestedDate`. `null` if not deliverable. */
    availableDate: IsoDateSchema.nullable().describe('Earliest delivery date; null = not deliverable'),
    /** Order cut-off instant to receive goods on `availableDate` (Aimo `closingTime`); `null` if unknown. */
    cutoffTime: IsoDateTimeSchema.nullable().describe('Order cut-off instant; null = unknown'),
    /** Aimo sales block flag — `true` means it cannot be ordered now (policy: SALES_BLOCK, blocked). */
    salesBlock: z.boolean().describe('Aimo sales block'),
    /** Country of origin (copied from the catalogue), `null` if unknown. */
    origin: CountryCodeSchema.nullable().describe('Country of origin; null = unknown'),
    /** Certification/sustainability label codes (copied from the catalogue). */
    labels: z.array(z.string().min(1)).describe('Label codes'),
    /** Start of the price validity window (instant). */
    validFrom: IsoDateTimeSchema.describe('Offer valid from'),
    /** End of the price validity window (instant). After this, policy raises OFFER_EXPIRED. Typically issuedAt + 30 min. */
    validUntil: IsoDateTimeSchema.describe('Offer valid until'),
    /** Issuer identifier — JWKS URL or `did:web:` of the Aimo gateway, e.g. `https://localhost:8787/.well-known/jwks.json`. */
    issuer: z.string().min(1).describe('Issuer (JWKS URL or did:web)'),
    /** When the gateway created and signed the offer. */
    issuedAt: IsoDateTimeSchema.describe('Issued at'),
  })
  .describe('Fixed-price offer payload (what Valio Aimo signs)');
export type Offer = z.infer<typeof OfferSchema>;

/** An offer plus its JWS. Agents verify `jws` against the gateway JWKS before relying on `offer`. */
export const SignedOfferSchema = z
  .object({
    /** Human/UI-readable copy of the signed payload. */
    offer: OfferSchema,
    /** Compact JWS over `canonicalJson(offer)`. */
    jws: CompactJwsSchema,
  })
  .describe('Signed offer');
export type SignedOffer = z.infer<typeof SignedOfferSchema>;
