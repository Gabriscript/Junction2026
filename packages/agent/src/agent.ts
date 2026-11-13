import { Order, Product, type Decision, type Offer, type ReasonCode, type StructuredNeed, type Unit } from './contract';
import type { GatewayClient } from './gateway';
import { extractNeed, type LLMProvider } from './llm';
import { packMath, packSizeOf, type PackPlan } from './packMath';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { offerIsCurrent, verifyOffer, type Trust } from './verify';

export interface TraceStep {
  action: string;
  input: string;
  output: string;
}

/** A verified offer that covers the needed quantity and date. */
export interface Candidate {
  offer: Offer; // the signed payload, not the plain copy
  product: Product;
  pack: PackPlan;
  totalCents: number; // integer euro cents ex VAT for pack.packs
}

export interface RejectedOffer {
  offerId: string;
  productId: string;
  reasonCode: ReasonCode;
}

export type SelectOffer = (candidates: Candidate[], need: StructuredNeed) => Candidate | undefined;

export interface AgentDeps {
  llm: LLMProvider;
  gateway: GatewayClient;
  /** Read again at every time-sensitive step: a run can outlive an offer. */
  now: () => Date;
  /** Trusted offer issuer and its keys. From configuration, never from `gateway`. */
  trust: Trust;
  /** Buyer mandate. The spend cap (EUR ex VAT per order) is enforced locally; the whole object is passed on to the gateway. */
  mandate: { maxOrderTotalEur: number; [key: string]: unknown };
  /** Extension point for step 8 (ranking, substitution, partial fill). Default: cheapest total. */
  select?: SelectOffer;
}

export interface AgentResult {
  need: StructuredNeed;
  /** True when an order was submitted: auto-approved or waiting for approval. Never true for a blocked order. */
  ordered: boolean;
  status: Decision['status'];
  decision: Decision;
  order?: Order;
  chosen?: Candidate;
  rejected: RejectedOffer[];
  trace: TraceStep[];
}

const SHORTLIST_SIZE = 5;
// money is integer euro cents: rounded once (half up) from the decimal EUR the contract gives, formatted only at the edge
const toCents = (euros: number) => Math.floor(euros * 100 + 0.5 + 1e-9);
const eur = (cents: number) => `€${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toUnit = (baseUnit: string): Unit => (baseUnit === 'L' || baseUnit === 'KG' ? baseUnit : 'PCS');

/**
 * Makes a gateway-supplied string safe to show: no control or invisible formatting characters
 * (newlines, ANSI escapes, bidi overrides), bounded length. Use it for every such string written
 * to the trace or the console. It does not make text safe as LLM input: the raw trace must never
 * be fed to an LLM.
 */
export const clean = (value: string, max = 120) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').slice(0, max);

const lower = (values: string[]) => values.map((value) => value.toLowerCase());

/** Product data is unsigned: never rely on the gateway having applied the need's filters. */
function matchesNeed(product: Product, need: StructuredNeed): boolean {
  const attributes = lower(product.attributes);
  if (!lower(need.attributes).every((attribute) => attributes.includes(attribute))) return false;
  if (!need.freeFromAllergens.length) return true;
  if (!product.allergens) return false; // unknown allergen data cannot prove "free from"
  const allergens = lower(product.allergens);
  return !lower(need.freeFromAllergens).some((allergen) => allergens.includes(allergen));
}

export const cheapest: SelectOffer = (candidates) => [...candidates].sort((a, b) => a.totalCents - b.totalCents)[0];

export async function runAgent(text: string, deps: AgentDeps): Promise<AgentResult> {
  const { gateway, now } = deps;
  const trace: TraceStep[] = [];
  const step = (action: string, input: string, output: string) => trace.push({ action, input, output });
  const rejected: RejectedOffer[] = [];

  const extraction = await extractNeed(text, deps.llm, now());
  const need = extraction.need;
  step(
    'parse_need',
    text,
    `${JSON.stringify(need)} via ${extraction.provider}` +
      (extraction.usedFallback ? ` (fallback to rule parser: ${extraction.fallbackReason})` : '') +
      (extraction.notes?.length ? ` (${extraction.notes.join('; ')})` : ''),
  );

  // the agent places no order: every reason found so far explains why
  const stop = (why: string): AgentResult => {
    const decision: Decision = { status: 'blocked', reasonCodes: [...new Set(rejected.map((r) => r.reasonCode))] };
    step('stop', why, `not ordered: ${decision.reasonCodes.join(', ') || 'no reason code applies'}`);
    return { need, ordered: false, status: 'blocked', decision, rejected, trace };
  };

  // nothing the gateway sends or fails to send may crash the run: stop, blocked, and keep the trace
  try {
    const search = { text: need.productQuery, attributes: need.attributes, free_from_allergens: need.freeFromAllergens, unit: need.unit };
    const products = Product.array().parse(await gateway.searchProducts(search));
    // shortcut: only products sold in the need's unit and with a known pack size, convert L↔KG↔PCS via unitConversions in step 8
    const matching = products.filter((product) => matchesNeed(product, need));
    const excluded = products.length - matching.length;
    const shortlist = matching.filter((product) => toUnit(product.baseUnit) === need.unit && packSizeOf(product)).slice(0, SHORTLIST_SIZE);
    step(
      'search_products',
      JSON.stringify(search),
      `${products.length} found, ${excluded} excluded by the local attribute and allergen check, shortlist: ${shortlist.map((p) => clean(p.id)).join(', ') || 'none'}`,
    );
    if (!shortlist.length) return stop('no matching product');

    const offersInput = {
      product_ids: shortlist.map((product) => product.id),
      quantity: need.quantity,
      unit: need.unit,
      ...(need.deliveryBy ? { delivery_date: need.deliveryBy } : {}),
    };
    const offers = z.array(z.unknown()).parse(await gateway.getOffers(offersInput));
    step('get_offers', JSON.stringify(offersInput), `${offers.length} signed offers`);

    const candidates: Candidate[] = [];
    const seenOfferIds = new Set<string>();
    for (const raw of offers) {
      const label = { offerId: clean(String((raw as any)?.offer?.offerId ?? 'unknown')), productId: clean(String((raw as any)?.offer?.productId ?? 'unknown')) };
      const input = `${label.offerId} (${label.productId})`;
      const reject = (reasonCode: ReasonCode, detail: string) => {
        rejected.push({ ...label, reasonCode });
        step('verify_offer', input, `rejected ${reasonCode}: ${detail}`);
      };

      const verified = await verifyOffer(raw, deps.trust, now());
      if (!verified.ok) {
        reject(verified.reasonCode, verified.reasonCode === 'OFFER_EXPIRED' ? 'outside its validity window' : 'signature or signed fields do not match');
        continue;
      }
      const offer = verified.offer;
      const product = shortlist.find((candidate) => candidate.id === offer.productId);
      if (!product) {
        step('verify_offer', input, 'ignored: offer is for a product that was not requested');
        continue;
      }
      const pack = packMath(need, packSizeOf(product)!, product.allowedLotSize);
      // a genuine signature only proves Aimo made this offer, not that it answers this request
      const mismatch = seenOfferIds.has(offer.offerId)
        ? 'duplicate offer id'
        : offer.unit !== product.salesUnit
          ? `unit ${clean(offer.unit ?? 'missing')} is not the sales unit ${clean(product.salesUnit)}`
          : offer.currency !== 'EUR'
            ? `currency ${clean(offer.currency ?? 'missing')} is not EUR`
            : offer.quantity !== pack.packs
              ? `quoted for ${offer.quantity ?? 'no'} packs, ${pack.packs} requested`
              : need.deliveryBy && offer.requestedDate !== need.deliveryBy
                ? `quoted for ${offer.requestedDate ?? 'no date'}, ${need.deliveryBy} requested`
                : undefined;
      seenOfferIds.add(offer.offerId);
      if (mismatch) {
        step('verify_offer', input, `ignored: offer does not match the request (${mismatch})`);
        continue;
      }
      if (offer.salesBlock) {
        reject('SALES_BLOCK', 'product cannot be ordered now');
        continue;
      }
      if (!offer.availableDate || (need.deliveryBy && offer.availableDate > need.deliveryBy)) {
        reject('DELIVERY_LATER_THAN_NEEDED', `available ${offer.availableDate ?? 'on no date'}, needed by ${need.deliveryBy ?? 'any date'}`);
        continue;
      }
      if (offer.availableQuantity === null || pack.packs > offer.availableQuantity) {
        reject('PARTIAL_AVAILABILITY', `${offer.availableQuantity ?? 'unknown number'} of ${pack.packs} packs available`);
        continue;
      }
      const totalCents = toCents(pack.packs * offer.unitPrice);
      candidates.push({ offer, product, pack, totalCents });
      step('verify_offer', input, `signature valid, ${eur(toCents(offer.unitPrice))} per pack, available ${offer.availableDate}, total ${eur(totalCents)} ex VAT${offer.quantityVerified === false ? ', stock not verified' : ''}`);
    }

    const chosen = (deps.select ?? cheapest)(candidates, need);
    if (!chosen) return stop(`${candidates.length} usable offers`);
    const chosenLabel = { offerId: clean(chosen.offer.offerId), productId: clean(chosen.offer.productId) };
    step('select_offer', `${candidates.length} usable offers`, `${chosenLabel.offerId}: ${clean(chosen.product.name)}, ${eur(chosen.totalCents)} ex VAT`);
    step('pack_math', `${need.quantity} ${need.unit}, pack size ${chosen.pack.packSize} ${need.unit}`, chosen.pack.note);

    // time has passed since verification: the offer must still be valid at the moment of ordering
    if (!offerIsCurrent(chosen.offer, now())) {
      rejected.push({ ...chosenLabel, reasonCode: 'OFFER_EXPIRED' });
      return stop(`${chosenLabel.offerId} is no longer valid`);
    }

    // local spend cap, checked before the gateway sees anything. Written as !(a <= b) so a NaN cap blocks instead of allowing.
    const capCents = toCents(deps.mandate.maxOrderTotalEur);
    if (!(chosen.totalCents <= capCents)) {
      rejected.push({ ...chosenLabel, reasonCode: 'OVER_BUDGET' });
      return stop(`${eur(chosen.totalCents)} is above the mandate limit of ${eur(capCents)} per order`);
    }

    const proposal = { offer_ids: [chosen.offer.offerId], quantities: [chosen.pack.packs], mandate: deps.mandate };
    const response = Order.safeParse(await gateway.proposeOrder(proposal));
    // the response is as untrusted as any other gateway output: it must be an order for exactly what was proposed
    if (!response.success || !isDeepStrictEqual(response.data.offerIds, proposal.offer_ids) || !isDeepStrictEqual(response.data.quantities, proposal.quantities)) {
      return stop('the order response does not match the proposal: order state unknown, check the gateway');
    }
    const order = response.data;
    step(
      'propose_order',
      `${chosen.pack.packs} × ${chosenLabel.offerId}`,
      `${clean(order.orderId)}: ${order.decision.status}${order.decision.reasonCodes.length ? ` (${order.decision.reasonCodes.join(', ')})` : ''}`,
    );

    // Terminal stock is a placeholder number, not a verified quantity: say so, whatever the gateway decided
    const reasonCodes = chosen.offer.quantityVerified === false ? [...new Set<ReasonCode>([...order.decision.reasonCodes, 'UNVERIFIED_STOCK'])] : order.decision.reasonCodes;
    const decision: Decision = { ...order.decision, reasonCodes };
    return { need, ordered: decision.status !== 'blocked', status: decision.status, decision, order, chosen, rejected, trace };
  } catch (error) {
    step('error', 'gateway call or response', clean(error instanceof Error ? error.message : String(error), 300) || 'unknown error');
    return stop('the run failed: if an order was proposed, its state is unknown');
  }
}
