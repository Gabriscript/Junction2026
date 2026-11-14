import type { AuditEvent } from './contract';

export const GENESIS_HASH = '0'.repeat(64);

/** JSON with object keys sorted at every level, no whitespace, undefined omitted. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** hash = hex(SHA-256(prevHash + "\n" + canonicalJson(event without hash and prevHash))). */
export async function hashEvent(event: Omit<AuditEvent, 'hash'>): Promise<string> {
  const { prevHash, ...body } = event;
  const bytes = new TextEncoder().encode(`${prevHash}\n${canonicalJson(body)}`);
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
 * previous event is checked when that event is in the list (seq - 1), or when seq is 1 (genesis).
 */
export async function verifyChain(events: AuditEvent[]): Promise<ChainResult> {
  let outsideLinks = 0;
  for (let i = 0; i < events.length; i++) {
    const { hash, ...rest } = events[i]!;
    if ((await hashEvent(rest)) !== hash) return { ok: false, brokenAt: rest.seq, outsideLinks };
    const prev = events[i - 1];
    if (rest.seq === 1) {
      if (rest.prevHash !== GENESIS_HASH) return { ok: false, brokenAt: rest.seq, outsideLinks };
    } else if (prev && prev.seq === rest.seq - 1) {
      if (rest.prevHash !== prev.hash) return { ok: false, brokenAt: rest.seq, outsideLinks };
    } else {
      outsideLinks++;
    }
  }
  return { ok: true, outsideLinks };
}
