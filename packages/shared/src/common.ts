/**
 * Primitive building blocks reused by every schema in the contract.
 *
 * Conventions (apply everywhere in `@junction/shared`):
 * - Dates/times are ISO 8601 strings, never Date objects or epoch numbers.
 *   - Instants carry an explicit UTC offset: `2026-11-16T00:00:00+02:00` or `...Z`.
 *     The Aimo mock returns `+0200` (no colon); the gateway normalises to `+02:00`.
 *   - Calendar dates (delivery dates, needed-by) are `YYYY-MM-DD`.
 * - Money is EUR, expressed as a decimal number exactly as the Aimo price API
 *   returns it (e.g. `64.17`). Do arithmetic in integer cents and round half-up
 *   to 2 decimals before writing a value back into a schema.
 * - Percentages are plain numbers in percent (`13.5` = 13.5 %), never fractions.
 * - Ratios such as delivery reliability are fractions in `[0, 1]`.
 * - `null` always means "unknown / not provided by Aimo". Never invent a value
 *   to fill a null; show it as unknown in the UI and treat it conservatively
 *   in policy (unknown allergen data = unsafe).
 */
import { z } from 'zod';

/** RFC 3339 / ISO 8601 instant with explicit offset (`Z` or `±hh:mm`). */
export const IsoDateTimeSchema = z
  .iso.datetime({ offset: true })
  .describe('ISO 8601 instant with explicit UTC offset, e.g. 2026-11-16T00:00:00+02:00');
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** Calendar date `YYYY-MM-DD` (no time, no zone). Used for delivery dates. */
export const IsoDateSchema = z.iso.date().describe('Calendar date YYYY-MM-DD');
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** The only currency in the prototype. Kept as a field so payloads are self-describing. */
export const CurrencySchema = z.literal('EUR').describe('ISO 4217 currency code; always EUR');
export type Currency = z.infer<typeof CurrencySchema>;

/** Non-negative EUR amount as a decimal number with at most 2 decimals (e.g. 1290.5). */
export const EurAmountSchema = z
  .number()
  .finite()
  .nonnegative()
  .describe('Amount in EUR as a decimal number, max 2 decimals');
export type EurAmount = z.infer<typeof EurAmountSchema>;

/** VAT rate in percent. Finnish rates seen in the data: 13.5 (food), 25.5 (standard), 10 (reduced). */
export const VatRatePercentSchema = z
  .number()
  .min(0)
  .max(100)
  .describe('VAT rate in percent, e.g. 13.5 for food in Finland');
export type VatRatePercent = z.infer<typeof VatRatePercentSchema>;

/** ISO 3166-1 alpha-2 country code, upper-case (the dataset is lower-case; the gateway upper-cases). */
export const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .describe('ISO 3166-1 alpha-2 country code, upper-case, e.g. FI');
export type CountryCode = z.infer<typeof CountryCodeSchema>;

/**
 * Aimo sales-unit code, verbatim from the catalogue / availability API.
 * Observed codes: KI (crate), ST (piece), KG, PAK, BAG, RAS, PRK, BOT, L, SK, CS, KLE, KRT, KAN, PAL.
 * The dataset ships no translations, so this stays a free string; `UNIT_CODE_NAMES` has best-effort labels.
 */
export const UnitCodeSchema = z
  .string()
  .min(1)
  .max(8)
  .describe('Aimo sales-unit code, e.g. KI (crate), ST (piece), KG, L, PAK');
export type UnitCode = z.infer<typeof UnitCodeSchema>;

/** Best-effort human labels for unit codes. Unknown codes are displayed verbatim, never guessed. */
export const UNIT_CODE_NAMES: Readonly<Record<string, string>> = {
  KI: 'crate',
  ST: 'piece',
  KG: 'kilogram',
  L: 'litre',
  PAK: 'pack',
  BAG: 'bag',
  RAS: 'box',
  PRK: 'carton',
  BOT: 'bottle',
  SK: 'sack',
  CS: 'case',
  KRT: 'cardboard box',
  KAN: 'canister',
  PAL: 'pallet',
};

/** Unit of the per-unit comparison price (`comparisonPrice`): litres or kilograms. */
export const ComparisonUnitSchema = z.enum(['L', 'KG']).describe('Comparison unit: L or KG');
export type ComparisonUnit = z.infer<typeof ComparisonUnitSchema>;

/** Aimo logistic model: `Stock` = own warehouse, real quantity; `Terminal` = supplier ship-through, quantity unknown. */
export const LogisticModelSchema = z
  .enum(['Stock', 'Terminal'])
  .describe('Stock = Valio Aimo warehouse (quantity verified); Terminal = shipped from supplier (quantity unverified)');
export type LogisticModel = z.infer<typeof LogisticModelSchema>;

/** 6-digit Aimo product code, identical across catalogue JSON, price/availability APIs and CSVs. */
export const ProductIdSchema = z
  .string()
  .regex(/^\d{6}$/)
  .describe('6-digit Aimo product code, e.g. 460063');
export type ProductId = z.infer<typeof ProductIdSchema>;

/** Opaque non-empty identifier (offer, order, mandate, agent, org, ...). The gateway uses ULIDs/UUIDs. */
export const IdSchema = z.string().min(1).max(128).describe('Opaque identifier');

/** Lower-case hex SHA-256 digest (64 chars). */
export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe('SHA-256 digest, lower-case hex, 64 chars');
export type Sha256Hex = z.infer<typeof Sha256HexSchema>;

/** JWS in compact serialization: `base64url(header).base64url(payload).base64url(signature)`. */
export const CompactJwsSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/)
  .describe('JWS compact serialization (RFC 7515)');
export type CompactJws = z.infer<typeof CompactJwsSchema>;

/** Price totals for a line or an order. `gross = net + vat`, all EUR. */
export const TotalsSchema = z
  .object({
    /** Sum of unit prices × quantities, excluding VAT. */
    net: EurAmountSchema.describe('Total excluding VAT, EUR'),
    /** VAT amount. */
    vat: EurAmountSchema.describe('VAT amount, EUR'),
    /** Total including VAT (`net + vat`). */
    gross: EurAmountSchema.describe('Total including VAT, EUR'),
    /** Always EUR. */
    currency: CurrencySchema,
  })
  .describe('Net / VAT / gross totals in EUR');
export type Totals = z.infer<typeof TotalsSchema>;

/**
 * Who performed an action. `agent` = an AI purchasing agent (id = agentId),
 * `human` = a person (approver / mandate issuer), `gateway` = the Aimo gateway itself (policy, signing).
 */
export const ActorSchema = z
  .object({
    type: z.enum(['agent', 'human', 'gateway']).describe('agent | human | gateway'),
    /** Stable identifier of the actor, e.g. `agent:hotel-buyer-1`, `user:chef.anna`, `gateway`. */
    id: IdSchema.describe('Actor identifier'),
    /** Optional display name for UIs. */
    name: z.string().min(1).optional().describe('Display name'),
  })
  .describe('Actor performing an action');
export type Actor = z.infer<typeof ActorSchema>;

/**
 * Deterministic JSON serialisation: object keys sorted recursively, no whitespace,
 * `undefined` properties dropped. Both sides MUST use this before hashing or signing
 * (JWS payloads of offers/mandates, audit-chain hashes) so bytes match exactly.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Round a EUR amount to 2 decimals (half-up via integer cents). Use after any multiplication. */
export function roundEur(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Compute totals from a net amount and a VAT rate in percent. */
export function totalsFromNet(net: number, vatRatePercent: number): Totals {
  const roundedNet = roundEur(net);
  const vat = roundEur((roundedNet * vatRatePercent) / 100);
  return { net: roundedNet, vat, gross: roundEur(roundedNet + vat), currency: 'EUR' };
}
