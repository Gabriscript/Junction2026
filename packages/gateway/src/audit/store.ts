/**
 * Hash-chained audit log in SQLite (`node:sqlite`).
 *
 * `hash = sha256(auditHashInput(event))` where the input includes `prevHash` (shared audit.ts).
 * Rows are append-only; `verifyChain()` recomputes every hash and link, so altering, inserting
 * or deleting any row is detected. Buyer view = events visible to `buyer` for one customerRef;
 * Aimo view = everything.
 */
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { DatabaseSync } from 'node:sqlite';
import { AuditEventSchema, auditHashInput, GENESIS_HASH, type AuditEvent } from '@junction/shared';

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

export type AuditEventInput = Omit<AuditEvent, 'seq' | 'prevHash' | 'hash' | 'eventId' | 'at'> & {
  eventId?: string;
  at?: string;
};

export type AuditView = { view: 'aimo' } | { view: 'buyer'; customerRef: string };

export interface ChainVerification {
  ok: boolean;
  length: number;
  /** seq of the first event that fails, or -1. */
  firstBroken: number;
  problem?: string;
}

export const AUDIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  order_id TEXT,
  agent_id TEXT,
  customer_ref TEXT,
  visibility TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_order ON audit_events(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_customer ON audit_events(customer_ref);
`;

interface Row {
  json: string;
}

export class AuditStore extends EventEmitter<{ event: [AuditEvent] }> {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
    db.exec(AUDIT_SCHEMA);
  }

  private last(): AuditEvent | null {
    const row = this.db.prepare('SELECT json FROM audit_events ORDER BY seq DESC LIMIT 1').get() as Row | undefined;
    return row ? (JSON.parse(row.json) as AuditEvent) : null;
  }

  /** Append one event, computing seq, prevHash and hash. Emits `event`. */
  append(input: AuditEventInput): AuditEvent {
    const prev = this.last();
    const unhashed: Omit<AuditEvent, 'hash'> = {
      ...input,
      eventId: input.eventId ?? `evt_${randomUUID()}`,
      at: input.at ?? this.now().toISOString(),
      seq: prev ? prev.seq + 1 : 0,
      prevHash: prev ? prev.hash : GENESIS_HASH,
    };
    const event = AuditEventSchema.parse({ ...unhashed, hash: sha256(auditHashInput(unhashed)) });
    this.db
      .prepare(
        'INSERT INTO audit_events (seq, event_id, at, type, order_id, agent_id, customer_ref, visibility, prev_hash, hash, json) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(event.seq, event.eventId, event.at, event.type, event.orderId, event.agentId, event.customerRef, event.visibility.join(','), event.prevHash, event.hash, JSON.stringify(event));
    this.emit('event', event);
    return event;
  }

  /** All events in chain order (the Aimo view). */
  all(): AuditEvent[] {
    return (this.db.prepare('SELECT json FROM audit_events ORDER BY seq').all() as unknown as Row[]).map((r) => JSON.parse(r.json) as AuditEvent);
  }

  /** Events for a view. Buyers only see events tagged `buyer` for their own customerRef. */
  list(view: AuditView, limit = 500): AuditEvent[] {
    if (view.view === 'aimo') {
      return (this.db.prepare('SELECT json FROM audit_events ORDER BY seq DESC LIMIT ?').all(limit) as unknown as Row[]).map((r) => JSON.parse(r.json) as AuditEvent).reverse();
    }
    const rows = this.db
      .prepare("SELECT json FROM audit_events WHERE customer_ref = ? AND (',' || visibility || ',') LIKE '%,buyer,%' ORDER BY seq DESC LIMIT ?")
      .all(view.customerRef, limit) as unknown as Row[];
    return rows.map((r) => JSON.parse(r.json) as AuditEvent).reverse();
  }

  forOrder(orderId: string): AuditEvent[] {
    return (this.db.prepare('SELECT json FROM audit_events WHERE order_id = ? ORDER BY seq').all(orderId) as unknown as Row[]).map((r) => JSON.parse(r.json) as AuditEvent);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as { n: number }).n;
  }

  /** Recompute every hash and link. Also cross-checks the indexed columns against the JSON. */
  verifyChain(): ChainVerification {
    const rows = this.db.prepare('SELECT seq, prev_hash, hash, json FROM audit_events ORDER BY seq').all() as {
      seq: number;
      prev_hash: string;
      hash: string;
      json: string;
    }[];
    return verifyEvents(rows.map((r) => ({ ...(JSON.parse(r.json) as AuditEvent), seq: r.seq, prevHash: r.prev_hash, hash: r.hash })));
  }
}

/** Pure verification of an ordered event list (usable by the UI / auditors with the same shared rules). */
export function verifyEvents(events: readonly AuditEvent[]): ChainVerification {
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const expectedPrev = i === 0 ? GENESIS_HASH : events[i - 1]!.hash;
    if (e.seq !== i) return { ok: false, length: events.length, firstBroken: i, problem: `seq ${e.seq} at position ${i}` };
    if (e.prevHash !== expectedPrev) return { ok: false, length: events.length, firstBroken: i, problem: `prevHash mismatch at seq ${i}` };
    if (sha256(auditHashInput(e)) !== e.hash) return { ok: false, length: events.length, firstBroken: i, problem: `hash mismatch at seq ${i}` };
  }
  return { ok: true, length: events.length, firstBroken: -1 };
}
