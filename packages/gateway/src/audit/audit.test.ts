import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import * as fx from '@junction/shared/fixtures';
import { AuditStore, verifyEvents, type AuditEventInput } from './store.js';

const base = (over: Partial<AuditEventInput> = {}): AuditEventInput => ({
  type: 'order_proposed',
  actor: fx.hotelAgent,
  orderId: 'ord_1',
  agentId: fx.hotelAgent.id,
  customerRef: '123',
  reasonCodes: [],
  summary: 'agent proposed ord_1',
  data: { offerIds: ['off_1'] },
  visibility: ['buyer', 'aimo'],
  ...over,
});

function store() {
  let t = Date.parse('2026-11-14T09:00:00+02:00');
  const db = new DatabaseSync(':memory:');
  return { db, audit: new AuditStore(db, () => new Date((t += 60_000))) };
}

describe('audit chain', () => {
  it('links events from the genesis hash and verifies', () => {
    const { audit } = store();
    const events: unknown[] = [];
    audit.on('event', (e) => events.push(e));
    const e0 = audit.append(base({ type: 'offers_issued', orderId: null, actor: fx.gatewayActor }));
    const e1 = audit.append(base());
    const e2 = audit.append(base({ type: 'order_decided', actor: fx.gatewayActor, customerRef: null, visibility: ['aimo'] }));
    expect(e0.seq).toBe(0);
    expect(e0.prevHash).toBe('0'.repeat(64));
    expect(e1.prevHash).toBe(e0.hash);
    expect(e2.prevHash).toBe(e1.hash);
    expect(audit.verifyChain()).toEqual({ ok: true, length: 3, firstBroken: -1 });
    expect(events).toHaveLength(3);
    expect(audit.count()).toBe(3);
  });

  it('the shared fixture chain verifies with the same algorithm', () => {
    expect(verifyEvents(fx.auditChain).ok).toBe(true);
    const broken = fx.auditChain.map((e, i) => (i === 2 ? { ...e, summary: 'edited' } : e));
    expect(verifyEvents(broken)).toMatchObject({ ok: false, firstBroken: 2 });
  });

  it('altering any stored row breaks verification from that row on', () => {
    const { db, audit } = store();
    for (let i = 0; i < 4; i++) audit.append(base({ summary: `event ${i}` }));
    expect(audit.verifyChain().ok).toBe(true);

    // Tamper with the payload of row 1 (e.g. change the summary / amounts).
    const row = db.prepare('SELECT json FROM audit_events WHERE seq = 1').get() as { json: string };
    const altered = { ...(JSON.parse(row.json) as Record<string, unknown>), summary: 'nothing to see here' };
    db.prepare('UPDATE audit_events SET json = ? WHERE seq = 1').run(JSON.stringify(altered));
    expect(audit.verifyChain()).toMatchObject({ ok: false, firstBroken: 1, problem: expect.stringContaining('hash mismatch') });

    // Deleting a row breaks the sequence.
    const fresh = store();
    for (let i = 0; i < 3; i++) fresh.audit.append(base());
    fresh.db.prepare('DELETE FROM audit_events WHERE seq = 1').run();
    expect(fresh.audit.verifyChain()).toMatchObject({ ok: false, firstBroken: 1 });

    // Re-hashing a tampered row without fixing the successors still breaks the chain at the next row.
    const re = store();
    const a = re.audit.append(base());
    re.audit.append(base());
    const tampered = { ...a, data: { offerIds: ['off_evil'] } };
    const { sha256 } = await_import();
    const { auditHashInput } = await_shared();
    const newHash = sha256(auditHashInput(tampered));
    re.db.prepare('UPDATE audit_events SET json = ?, hash = ? WHERE seq = 0').run(JSON.stringify({ ...tampered, hash: newHash }), newHash);
    expect(re.audit.verifyChain()).toMatchObject({ ok: false, firstBroken: 1, problem: expect.stringContaining('prevHash') });
  });

  it('buyer view is scoped to the customer and to buyer-visible events; Aimo sees all', () => {
    const { audit } = store();
    audit.append(base({ customerRef: '123' }));
    audit.append(base({ customerRef: '456', agentId: fx.hospitalAgent.id, actor: fx.hospitalAgent }));
    audit.append(base({ type: 'agent_rejected', customerRef: '123', visibility: ['aimo'], reasonCodes: ['UNKNOWN_AGENT'] }));
    audit.append(base({ type: 'order_decided', orderId: 'ord_2', customerRef: '123' }));

    const buyer = audit.list({ view: 'buyer', customerRef: '123' });
    expect(buyer.map((e) => e.seq)).toEqual([0, 3]);
    expect(audit.list({ view: 'buyer', customerRef: '456' }).map((e) => e.seq)).toEqual([1]);
    expect(audit.list({ view: 'aimo' })).toHaveLength(4);
    expect(audit.forOrder('ord_2').map((e) => e.seq)).toEqual([3]);
    expect(audit.all()).toHaveLength(4);
  });
});

// Small sync helpers so the test above reads top-down (ESM imports are hoisted anyway).
import { sha256 as _sha256 } from './store.js';
import { auditHashInput as _auditHashInput } from '@junction/shared';
function await_import() {
  return { sha256: _sha256 };
}
function await_shared() {
  return { auditHashInput: _auditHashInput };
}
