import { auditHashInput, GENESIS_HASH, type AuditEvent } from '@junction/shared';

/** hash = hex(SHA-256(auditHashInput(event))): the rule defined in @junction/shared audit.ts. */
export async function hashEvent(event: Omit<AuditEvent, 'hash'>): Promise<string> {
  const bytes = new TextEncoder().encode(auditHashInput(event));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ChainResult {
  ok: boolean;
  /** seq of the first event that fails, when not ok. */
  brokenAt?: number;
  /** Links to an event that is not in this list (a scoped view), so they cannot be followed here. */
  outsideLinks: number;
}

/**
 * Verifies events sorted by seq. Every event's own hash is recomputed. The link to the
 * previous event is checked when that event is in the list (seq - 1), or when seq is 0 (genesis).
 * Unlike shared `firstBrokenLink`, this tolerates gaps, because the buyer view is a filtered chain.
 */
export async function verifyChain(events: readonly AuditEvent[]): Promise<ChainResult> {
  let outsideLinks = 0;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if ((await hashEvent(event)) !== event.hash) return { ok: false, brokenAt: event.seq, outsideLinks };
    const prev = events[i - 1];
    if (event.seq === 0) {
      if (event.prevHash !== GENESIS_HASH) return { ok: false, brokenAt: event.seq, outsideLinks };
    } else if (prev && prev.seq === event.seq - 1) {
      if (event.prevHash !== prev.hash) return { ok: false, brokenAt: event.seq, outsideLinks };
    } else {
      outsideLinks++;
    }
  }
  return { ok: true, outsideLinks };
}
