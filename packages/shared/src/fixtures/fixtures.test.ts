import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditHashInput, firstBrokenLink, AuditEventSchema, GENESIS_HASH } from '../audit.js';
import { CompactJwsSchema } from '../common.js';
import { MandateSchema } from '../mandate.js';
import { SignedOfferSchema } from '../offer.js';
import { OrderSchema } from '../order.js';
import { ProductSchema } from '../product.js';
import { decisionStatusFor } from '../reason-codes.js';
import { TOOLS } from '../tools.js';
import * as fx from './index.js';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('fixtures are schema-valid', () => {
  it.each(fx.products.map((p) => [p.id, p] as const))('product %s', (_id, p) => {
    ProductSchema.parse(p);
  });

  it('signed offers', () => {
    for (const o of [fx.signedMilkOffer, fx.signedMilkAltOffer, fx.signedBreadOffer, fx.signedMuesliOffer]) {
      SignedOfferSchema.parse(o);
    }
    expect(CompactJwsSchema.parse(fx.FIXTURE_JWS)).toBe(fx.FIXTURE_JWS);
    expect(fx.milkOffer.quantityVerified).toBe(true);
    expect(fx.milkAltOffer.quantityVerified).toBe(false);
  });

  it('mandates', () => {
    for (const m of [fx.hotelMandate, fx.hospitalMandate, fx.expiredMandate]) MandateSchema.parse(m);
  });

  it('orders, with status consistent with the decision', () => {
    for (const o of fx.orders) {
      OrderSchema.parse(o);
      const codes = o.decision.reasons.map((r) => r.code);
      expect(o.decision.reasonCodes).toEqual([...new Set(codes)]);
      expect(o.decision.status).toBe(decisionStatusFor(codes));
    }
  });

  it('every tool has a valid input and output fixture', () => {
    const order = { order: fx.autoApprovedOrder };
    const pairs: [keyof typeof TOOLS, unknown, unknown][] = [
      ['search_products', fx.searchMilkInput, fx.searchMilkOutput],
      ['get_offers', fx.getMilkOffersInput, fx.getMilkOffersOutput],
      ['propose_order', fx.hotelProposal, order],
      ['approve_order', { orderId: 'ord_fx_2', approver: fx.hotelManager }, { order: fx.approvedOrder }],
      ['reject_order', { orderId: 'ord_fx_2', approver: fx.hotelManager, comment: 'Too risky' }, order],
      ['get_order', { orderId: 'ord_fx_1' }, order],
      ['explain', { orderId: 'ord_fx_2' }, fx.pendingExplanation],
    ];
    expect(pairs.map(([n]) => n).sort()).toEqual(Object.keys(TOOLS).sort());
    for (const [name, input, output] of pairs) {
      expect(TOOLS[name].input.safeParse(input).error, `${name} input`).toBeUndefined();
      expect(TOOLS[name].output.safeParse(output).error, `${name} output`).toBeUndefined();
    }
  });
});

describe('fixture audit chain', () => {
  it('is schema-valid and linked', () => {
    for (const e of fx.auditChain) AuditEventSchema.parse(e);
    expect(fx.auditChain[0]!.prevHash).toBe(GENESIS_HASH);
    expect(firstBrokenLink(fx.auditChain)).toBe(-1);
  });

  it('hashes are sha256(auditHashInput(event))', () => {
    const expected: { seq: number; prevHash: string; hash: string }[] = [];
    let prev = GENESIS_HASH;
    for (const e of fx.auditChain) {
      const hash = sha256(auditHashInput({ ...e, prevHash: prev }));
      expected.push({ seq: e.seq, prevHash: prev, hash });
      prev = hash;
    }
    const actual = fx.auditChain.map(({ seq, prevHash, hash }) => ({ seq, prevHash, hash }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      console.error('Expected audit fixture hashes:\n' + JSON.stringify(expected, null, 2));
    }
    expect(actual).toEqual(expected);
  });

  it('detects tampering', () => {
    const tampered = fx.auditChain.map((e) => ({ ...e }));
    tampered[1]!.summary = 'nothing happened';
    expect(sha256(auditHashInput(tampered[1]!))).not.toBe(tampered[1]!.hash);
    const reordered = [fx.auditChain[0]!, fx.auditChain[2]!, fx.auditChain[1]!, fx.auditChain[3]!];
    expect(firstBrokenLink(reordered)).toBe(1);
  });
});
