/**
 * Hash-chained audit log.
 *
 * Every security- or money-relevant step is appended as an `AuditEvent`. Each event commits
 * to the previous one: `hash = sha256(auditHashInput(event))` where the input includes
 * `prevHash`. Altering, inserting or deleting any row breaks verification from that row on.
 * The first event uses `GENESIS_HASH` as `prevHash`.
 *
 * Hashing itself lives in the gateway (`node:crypto`); this module only defines the exact
 * bytes to hash so any party (UI, auditors, other agents) can re-verify the chain.
 *
 * Views: buyers see events whose `visibility` includes `buyer` *and* whose `customerRef`
 * is theirs; Valio Aimo sees everything with `aimo` (i.e. all events).
 */
import { z } from 'zod';
import {
  ActorSchema,
  IdSchema,
  IsoDateTimeSchema,
  Sha256HexSchema,
  canonicalJson,
} from './common.js';
import { ReasonCodeSchema } from './reason-codes.js';

export const AUDIT_EVENT_TYPES = [
  'offers_issued',
  'order_proposed',
  'order_decided',
  'order_approved',
  'order_rejected',
  'offer_rejected',
  'agent_rejected',
  'query_budget_exceeded',
] as const;

export const AuditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES).describe('Audit event type');
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditVisibilitySchema = z.enum(['buyer', 'aimo']);
export type AuditVisibility = z.infer<typeof AuditVisibilitySchema>;

/** `prevHash` of the first event in the chain. */
export const GENESIS_HASH = '0'.repeat(64);

export const AuditEventSchema = z
  .object({
    /** Position in the chain, starting at 0, gap-free. */
    seq: z.number().int().nonnegative().describe('Chain position, 0-based'),
    eventId: IdSchema,
    at: IsoDateTimeSchema,
    type: AuditEventTypeSchema,
    actor: ActorSchema,
    /** Related order, when any. */
    orderId: IdSchema.nullable(),
    /** Related agent, when any (also set for rejected/unknown agents). */
    agentId: IdSchema.nullable(),
    /** Customer the event belongs to; drives the buyer view. `null` = Aimo-internal. */
    customerRef: z.string().min(1).nullable(),
    reasonCodes: z.array(ReasonCodeSchema),
    /** One human-readable line, e.g. "Order ord_01 blocked: ALLERGEN_CONFLICT on line 2". */
    summary: z.string().min(1),
    /** Event-specific details (offer ids, totals, …). Must be JSON-serialisable. */
    data: z.record(z.string(), z.unknown()),
    visibility: z.array(AuditVisibilitySchema).min(1),
    /** `hash` of the previous event, or `GENESIS_HASH` for seq 0. */
    prevHash: Sha256HexSchema,
    /** sha256 hex of `auditHashInput(this event)`. */
    hash: Sha256HexSchema,
  })
  .describe('Hash-chained audit event');
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/** The exact string to SHA-256 for an event: canonical JSON of every field except `hash`. */
export function auditHashInput(event: Omit<AuditEvent, 'hash'> | AuditEvent): string {
  const { hash: _ignored, ...rest } = event as AuditEvent;
  return canonicalJson(rest);
}

/**
 * Structural chain check (seq order + prevHash links), independent of the hash function.
 * Returns the index of the first broken event, or -1 when the links are intact.
 * Full verification additionally recomputes each `hash` (gateway / any sha256 implementation).
 */
export function firstBrokenLink(events: readonly AuditEvent[]): number {
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const expectedPrev = i === 0 ? GENESIS_HASH : events[i - 1]!.hash;
    if (e.seq !== i || e.prevHash !== expectedPrev) return i;
  }
  return -1;
}
