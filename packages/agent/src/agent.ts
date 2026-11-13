import { Product, type Decision, type Offer, type Order, type ReasonCode, type StructuredNeed, type Unit } from './contract';
import type { GatewayClient } from './gateway';
import { extractNeed, type LLMProvider } from './llm';
import { packMath, packSizeOf, type PackPlan } from './packMath';
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
  total: number; // EUR ex VAT for pack.packs
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
  mandate?: unknown;
  /** Extension point for step 8 (ranking, substitution, partial fill). Default: cheapest total. */
  select?: SelectOffer;
}

export interface AgentResult {
  need: StructuredNeed;
  ordered: boolean;
  decision: Decision;
  order?: Order;
  chosen?: Candidate;
  rejected: RejectedOffer[];
  trace: TraceStep[];
}

const SHORTLIST_SIZE = 5;
const eur = (value: number) => `€${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toUnit = (baseUnit: string): Unit => (baseUnit === 'L' || baseUnit === 'KG' ? baseUnit : 'PCS');

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

export const cheapest: SelectOffer = (candidates) => [...candidates].sort((a, b) => a.total - b.total)[0];

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
      (extraction.usedFallback ? ` (fallback to rule parser: ${extraction.fallbackReason})` : ''),
  );

  // the agent places no order: every reason found so far explains why
  const stop = (why: string): AgentResult => {
    const decision: Decision = { status: 'blocked', reasonCodes: [...new Set(rejected.map((r) => r.reasonCode))] };
    step('stop', why, `not ordered: ${decision.reasonCodes.join(', ') || 'no reason code applies'}`);
    return { need, ordered: false, decision, rejected, trace };
  };

  const search = { text: need.productQuery, attributes: need.attributes, free_from_allergens: need.freeFromAllergens, unit: need.unit };
  const products = Product.array().parse(await gateway.searchProducts(search));
  // shortcut: only products sold in the need's unit and with a known pack size, convert L↔KG↔PCS via unitConversions in step 8
  const matching = products.filter((product) => matchesNeed(product, need));
  const excluded = products.length - matching.length;
  const shortlist = matching.filter((product) => toUnit(product.baseUnit) === need.unit && packSizeOf(product)).slice(0, SHORTLIST_SIZE);
  step(
    'search_products',
    JSON.stringify(search),
    `${products.length} found, ${excluded} excluded by the local attribute and allergen check, shortlist: ${shortlist.map((p) => p.id).join(', ') || 'none'}`,
  );
  if (!shortlist.length) return stop('no matching product');

  const offersInput = {
    product_ids: shortlist.map((product) => product.id),
    quantity: need.quantity,
    unit: need.unit,
    ...(need.deliveryBy ? { delivery_date: need.deliveryBy } : {}),
  };
  const offers: unknown[] = await gateway.getOffers(offersInput);
  step('get_offers', JSON.stringify(offersInput), `${offers.length} signed offers`);

  const candidates: Candidate[] = [];
  const seenOfferIds = new Set<string>();
  for (const raw of offers) {
    const label = { offerId: String((raw as any)?.offer?.offerId ?? 'unknown'), productId: String((raw as any)?.offer?.productId ?? 'unknown') };
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
        ? `unit ${offer.unit ?? 'missing'} is not the sales unit ${product.salesUnit}`
        : offer.currency !== 'EUR'
          ? `currency ${offer.currency ?? 'missing'} is not EUR`
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
    if (pack.packs > offer.availableQuantity) {
      reject('PARTIAL_AVAILABILITY', `${offer.availableQuantity} of ${pack.packs} packs available`);
      continue;
    }
    const total = pack.packs * offer.unitPrice;
    candidates.push({ offer, product, pack, total });
    step('verify_offer', input, `signature valid, ${eur(offer.unitPrice)} per pack, available ${offer.availableDate}, total ${eur(total)} ex VAT`);
  }

  const chosen = (deps.select ?? cheapest)(candidates, need);
  if (!chosen) return stop(`${candidates.length} usable offers`);
  step('select_offer', `${candidates.length} usable offers`, `${chosen.offer.offerId}: ${chosen.product.name}, ${eur(chosen.total)} ex VAT`);
  step('pack_math', `${need.quantity} ${need.unit}, pack size ${chosen.pack.packSize} ${need.unit}`, chosen.pack.note);

  // time has passed since verification: the offer must still be valid at the moment of ordering
  if (!offerIsCurrent(chosen.offer, now())) {
    rejected.push({ offerId: chosen.offer.offerId, productId: chosen.offer.productId, reasonCode: 'OFFER_EXPIRED' });
    return stop(`${chosen.offer.offerId} is no longer valid`);
  }

  const proposal = { offer_ids: [chosen.offer.offerId], quantities: [chosen.pack.packs], mandate: deps.mandate };
  const order = await gateway.proposeOrder(proposal);
  step(
    'propose_order',
    `${chosen.pack.packs} × ${chosen.offer.offerId}`,
    `${order.orderId}: ${order.decision.status}${order.decision.reasonCodes.length ? ` (${order.decision.reasonCodes.join(', ')})` : ''}`,
  );

  return { need, ordered: true, decision: order.decision, order, chosen, rejected, trace };
}
