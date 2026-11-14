import type { Decision, Mandate, Offer, Order, Product, ReasonCode } from '@junction/shared';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { StructuredNeed } from './contract.js';
import { parseOutput, type GatewayClient } from './gateway-client.js';
import { addDays, extractNeed, todayIso, type LLMProvider } from './llm.js';
import { packMath, packSizeOf, type PackPlan } from './packMath.js';
import { offerIsCurrent, verifyOffer, type Trust } from './verify.js';

export interface TraceStep {
  action: string;
  input: string;
  output: string;
}

/** A verified offer that covers the needed quantity and date. */
export interface Candidate {
  offer: Offer; // the signed payload, not the plain copy
  jws: string; // sent back unchanged in the order line
  product: Product;
  pack: PackPlan;
  totalCents: number; // integer euro cents ex VAT for pack.packs
  grossCents: number; // the same incl. VAT, what the mandate limits count
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
  /** Buyer mandate, sent with the order. Its budget (EUR incl. VAT) is also enforced locally. */
  mandate: Mandate;
  /** Extension point for step 8 (ranking, substitution, partial fill). Default: cheapest total. */
  select?: SelectOffer;
}

export interface AgentResult {
  need: StructuredNeed;
  /** True when an order was submitted: auto-approved or waiting for approval. Never true for a blocked order. */
  ordered: boolean;
  status: Decision['status'];
  /** The gateway's full decision is in order.decision. */
  decision: Pick<Decision, 'status' | 'reasonCodes'>;
  order?: Order;
  chosen?: Candidate;
  rejected: RejectedOffer[];
  trace: TraceStep[];
}

const SHORTLIST_SIZE = 5;
// money is integer euro cents: rounded once (half up) from the decimal EUR the contract gives, formatted only at the edge
const toCents = (euros: number) => Math.floor(euros * 100 + 0.5 + 1e-9);
const eur = (cents: number) => `€${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Makes a gateway-supplied string safe to show: no control or invisible formatting characters
 * (newlines, ANSI escapes, bidi overrides), bounded length. Use it for every such string written
 * to the trace or the console. It does not make text safe as LLM input: the raw trace must never
 * be fed to an LLM.
 */
export const clean = (value: string, max = 120) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').slice(0, max);

/**
 * Product data is unsigned: never rely on the gateway having applied the need's filters.
 * Free from a code = an explicit FREE_FROM, or allergen data present without CONTAINS/MAY_CONTAIN
 * for it (the mandate rule in shared): no allergen data at all cannot prove "free from".
 */
function matchesNeed(product: Product, need: StructuredNeed): boolean {
  if (!need.attributes.every((attribute) => product.attributes.includes(attribute))) return false;
  return need.freeFromAllergens.every((code) => {
    const levels = product.allergens.filter((allergen) => allergen.code === code).map((allergen) => allergen.level);
    return levels.includes('FREE_FROM') || (product.allergens.length > 0 && !levels.length);
  });
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
    const decision: AgentResult['decision'] = { status: 'blocked', reasonCodes: [...new Set(rejected.map((r) => r.reasonCode))] };
    step('stop', why, `not ordered: ${decision.reasonCodes.join(', ') || 'no reason code applies'}`);
    return { need, ordered: false, status: 'blocked', decision, rejected, trace };
  };

  // nothing the gateway sends or fails to send may crash the run: stop, blocked, and keep the trace
  try {
    const search = { text: need.productQuery, attributes: need.attributes, freeFromAllergens: need.freeFromAllergens, unit: need.unit };
    const { products } = parseOutput('search_products', await gateway.search_products(search));
    // shortcut: only products whose net content is in the need's unit, convert L↔KG↔ST in step 8
    const matching = products.filter((product) => matchesNeed(product, need));
    const excluded = products.length - matching.length;
    const shortlist = matching.filter((product) => packSizeOf(product, need.unit)).slice(0, SHORTLIST_SIZE);
    step(
      'search_products',
      JSON.stringify(search),
      `${products.length} found, ${excluded} excluded by the local attribute and allergen check, shortlist: ${shortlist.map((p) => clean(p.id)).join(', ') || 'none'}`,
    );
    if (!shortlist.length) return stop('no matching product');

    // get_offers quotes sales units, so the pack math runs per product before asking
    const packs = new Map(shortlist.map((product) => [product.id, packMath(need, packSizeOf(product, need.unit)!, product.pack.allowedLotSize)]));
    // shortcut: a request without a date asks for tomorrow, the earliest a kitchen order is normally delivered
    const requestedDate = need.deliveryBy ?? addDays(todayIso(now()), 1);
    const { agentId, customerRef } = deps.mandate;
    const items = shortlist.map((product) => ({ productId: product.id, quantity: packs.get(product.id)!.packs }));
    const offersInput = { agentId, customerRef, items, requestedDate };
    // offers are checked one by one below: one malformed offer must not discard the others
    const offers = z.object({ offers: z.array(z.unknown()) }).parse(await gateway.get_offers(offersInput)).offers;
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
      const pack = packs.get(product.id)!;
      // a genuine signature only proves Aimo made this offer, not that it answers this request
      const mismatch = seenOfferIds.has(offer.offerId)
        ? 'duplicate offer id'
        : offer.unit !== product.pack.salesUnit
          ? `unit ${clean(offer.unit)} is not the sales unit ${clean(product.pack.salesUnit)}`
          : offer.quantity !== pack.packs
            ? `quoted for ${offer.quantity} packs, ${pack.packs} requested`
            : offer.requestedDate !== requestedDate
              ? `quoted for ${clean(offer.requestedDate)}, ${requestedDate} requested`
              : offer.customerRef !== customerRef
                ? 'quoted for another customer'
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
      const grossCents = totalCents + Math.floor((totalCents * offer.vatRate) / 100 + 0.5 + 1e-9); // VAT rounded once, half up
      const { jws } = raw as { jws: string }; // verifyOffer has parsed it
      candidates.push({ offer, jws, product, pack, totalCents, grossCents });
      step('verify_offer', input, `signature valid, ${eur(toCents(offer.unitPrice))} per pack, available ${offer.availableDate}, total ${eur(totalCents)} ex VAT${offer.quantityVerified ? '' : ', stock not verified'}`);
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

    // local budget check, before the gateway sees anything. Written as !(a <= b) so a NaN budget blocks instead of allowing.
    const capCents = toCents(deps.mandate.budgetLimit);
    if (!(chosen.grossCents <= capCents)) {
      rejected.push({ ...chosenLabel, reasonCode: 'OVER_BUDGET' });
      return stop(`${eur(chosen.grossCents)} incl. VAT is above the mandate budget of ${eur(capCents)}`);
    }

    const lines = [{ offerId: chosen.offer.offerId, offerJws: chosen.jws, quantity: chosen.pack.packs, substituteFor: null }];
    const proposal = { agentId, mandate: deps.mandate, lines, neededBy: requestedDate, requestText: text, rationale: `Cheapest verified offer: ${chosen.pack.note}` };
    const response = await gateway.propose_order(proposal);
    let order: Order;
    try {
      order = parseOutput('propose_order', response).order;
    } catch {
      return stop('the order response is not a valid order: order state unknown, check the gateway');
    }
    // the response is as untrusted as any other gateway output: it must be an order for exactly what was proposed
    const orderedLines = order.lines.map((line) => [line.offerId, line.quantity]);
    if (!isDeepStrictEqual(orderedLines, lines.map((line) => [line.offerId, line.quantity]))) {
      return stop('the order response does not match the proposal: order state unknown, check the gateway');
    }
    step(
      'propose_order',
      `${chosen.pack.packs} × ${chosenLabel.offerId}`,
      `${clean(order.orderId)}: ${order.decision.status}${order.decision.reasonCodes.length ? ` (${order.decision.reasonCodes.join(', ')})` : ''}`,
    );

    // Terminal stock is a placeholder number, not a verified quantity: say so, whatever the gateway decided
    const reasonCodes = chosen.offer.quantityVerified ? order.decision.reasonCodes : [...new Set<ReasonCode>([...order.decision.reasonCodes, 'UNVERIFIED_STOCK'])];
    const decision = { status: order.decision.status, reasonCodes };
    return { need, ordered: decision.status !== 'blocked', status: decision.status, decision, order, chosen, rejected, trace };
  } catch (error) {
    step('error', 'gateway call or response', clean(error instanceof Error ? error.message : String(error), 300) || 'unknown error');
    return stop('the run failed: if an order was proposed, its state is unknown');
  }
}
