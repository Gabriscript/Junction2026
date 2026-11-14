import { useEffect, useState, type ReactNode } from 'react';
import { MockGatewayApi, type GatewayApi } from '../api';
import { REASON_CODE_INFO, type Actor, type AuditEvent } from '@junction/shared';
import type { AuditScope } from '../contract';
import { verifyChain, type ChainResult } from '../hash';
import { AURORA, eur, Icon, shortHash, ToneIcon, useLive } from '../ui';

const actorLabel = (actor: Actor, scope: AuditScope) =>
  actor.type === 'human' ? (actor.name ?? 'Chef') : actor.type === 'gateway' ? 'Valio Aimo gateway' : scope === 'buyer' ? 'Mikko' : (actor.name ?? actor.id);

type Tone = 'ok' | 'warn' | 'stop' | 'info';
const reasonText = (e: AuditEvent) => e.reasonCodes.map((c) => REASON_CODE_INFO[c].title).join(' · ');
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One plain sentence per event: what happened, how it went (tone) and the useful detail. */
function describe(e: AuditEvent, scope: AuditScope): { tone: Tone; title: string; detail?: string } {
  const d = e.data as { offerIds?: unknown[]; unavailable?: unknown[]; status?: string; totals?: { gross?: number }; comment?: string | null; requestText?: string | null };
  const total = typeof d.totals?.gross === 'number' ? `${eur(d.totals.gross)} incl. VAT` : undefined;
  const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ') || undefined;
  const who = actorLabel(e.actor, scope);
  switch (e.type) {
    case 'offers_issued':
      return { tone: 'info', title: `Valio Aimo signed ${count(d.offerIds?.length ?? 0, 'price')}`, detail: d.unavailable?.length ? `${d.unavailable.length} not available` : 'Fixed prices for this order' };
    case 'order_proposed':
      return { tone: 'info', title: `${who} proposed an order`, detail: d.requestText ? `“${d.requestText}”` : d.offerIds ? count(d.offerIds.length, 'line') : undefined };
    case 'order_decided':
      if (d.status === 'auto_approved') return { tone: 'ok', title: 'Ordered automatically', detail: join('Within the rules', total) };
      if (d.status === 'blocked') return { tone: 'stop', title: 'Blocked by the gateway', detail: join(reasonText(e), total) };
      return { tone: 'warn', title: 'Waiting for the chef’s OK', detail: join(reasonText(e), total) };
    case 'order_approved':
      return { tone: 'ok', title: `${who} approved the order`, detail: join(d.comment ? `“${d.comment}”` : undefined, total) };
    case 'order_rejected':
      return { tone: 'stop', title: `${who} rejected the order`, detail: d.comment ? `“${d.comment}”` : undefined };
    case 'offer_rejected':
      return { tone: 'stop', title: 'Gateway refused the order', detail: reasonText(e) };
    case 'agent_rejected':
      return { tone: 'stop', title: 'Unknown agent turned away', detail: reasonText(e) };
    case 'query_budget_exceeded':
      return { tone: 'warn', title: 'Too many price lookups', detail: reasonText(e) };
  }
}

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Events grouped under one heading per day, keeping their order. */
function byDay(events: AuditEvent[]): [string, AuditEvent[]][] {
  const today = dayKey(new Date().toISOString());
  const groups = new Map<string, AuditEvent[]>();
  for (const e of events) {
    const key = dayKey(e.at) === today ? 'Today' : dayKey(e.at);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups];
}

/** Events whose title already names who acted, so the meta line leaves the actor out. */
const ACTOR_IN_TITLE = new Set<AuditEvent['type']>(['offers_issued', 'order_proposed', 'order_approved', 'order_rejected']);

/** Newest-first events of one day, those of the same order kept together where the order first appears. */
function byOrder(list: AuditEvent[]): AuditEvent[][] {
  const orders = new Map<string, AuditEvent[]>();
  const out: AuditEvent[][] = [];
  for (const e of list) {
    const group = e.orderId ? orders.get(e.orderId) : undefined;
    if (group) group.push(e);
    else {
      const fresh = [e];
      out.push(fresh);
      if (e.orderId) orders.set(e.orderId, fresh);
    }
  }
  return out;
}

const TONE_ICON: Record<Tone, 'ok' | 'warn' | 'stop'> = { ok: 'ok', warn: 'warn', stop: 'stop', info: 'ok' };

function Dot({ tone }: { tone: Tone }) {
  return (
    <span className="ev-dot" aria-hidden="true">
      {tone === 'info' ? <Icon name="shield" size={16} /> : <ToneIcon tone={TONE_ICON[tone]} />}
    </span>
  );
}

/** `grouped`: the row sits inside its order's fold, so hashes show directly; `lead`: the row whose title is the fold's summary. */
function EventRow({ event: e, scope, grouped = false, lead = false }: { event: AuditEvent; scope: AuditScope; grouped?: boolean; lead?: boolean }) {
  const { tone, title, detail } = describe(e, scope);
  const proof = (
    <>
      <p className="hashes">
        <span title={e.hash}>hash {shortHash(e.hash)}</span>
        <span title={e.prevHash}>
          follows {e.seq === 0 ? 'genesis' : `#${e.seq - 1}`} {shortHash(e.prevHash)}
        </span>
      </p>
      <p className="ev-raw">{e.summary}</p>
    </>
  );
  return (
    <li className={`ev ev-${tone}`}>
      <Dot tone={tone} />
      <div className="ev-body">
        {!lead && <p className="ev-title">{title}</p>}
        {detail && <p className="ev-detail">{detail}</p>}
        <p className="ev-meta">
          {!lead && <time dateTime={e.at}>{clock(e.at)}</time>}
          {!ACTOR_IN_TITLE.has(e.type) && <span>{actorLabel(e.actor, scope)}</span>}
          {e.orderId && (!grouped || lead) && <a href={`#/orders/${e.orderId}`}>{lead ? 'Open order' : `Order ${e.orderId}`}</a>}
          {scope === 'aimo' && <span>Mandate {String(e.data.mandateId ?? 'none')}</span>}
        </p>
        {grouped ? (
          <div className="ev-proof">{proof}</div>
        ) : (
          <details className="ev-proof">
            <summary>Proof #{e.seq}</summary>
            {proof}
          </details>
        )}
      </div>
    </li>
  );
}

/** One order's events of the day behind one fold: the newest event's title is the summary. */
function OrderGroup({ events, scope }: { events: AuditEvent[]; scope: AuditScope }) {
  const newest = events[0]!;
  const { tone, title } = describe(newest, scope);
  return (
    <li className={`ev ev-${tone}`}>
      <Dot tone={tone} />
      <details className="more ev-fold">
        <summary>
          <span className="ev-body">
            <span className="ev-title">{title}</span>
            <span className="ev-meta">
              <span>Order {newest.orderId}</span>
              <time dateTime={newest.at}>{clock(newest.at)}</time>
            </span>
          </span>
        </summary>
        <ol className="ev-list">
          {events.map((e, i) => (
            <EventRow key={e.seq} event={e} scope={scope} grouped lead={i === 0} />
          ))}
        </ol>
      </details>
    </li>
  );
}

/** `children` (the demo tamper button) sits inside the verified fold. */
function ChainStatus({ events, children }: { events: AuditEvent[]; children?: ReactNode }) {
  const [result, setResult] = useState<ChainResult>();

  useEffect(() => {
    let active = true;
    verifyChain(events).then((r) => active && setResult(r));
    return () => {
      active = false;
    };
  }, [events]);

  if (!result) return <p className="chain" role="status">Checking the hash chain...</p>;
  if (result.ok)
    return (
      <div className="chain tone-ok" data-tour="chain">
        <details className="more chain-fold">
          <summary>
            <strong role="status">Chain verified ✓</strong>
          </summary>
          <p>
            {`Nothing was changed after it was written: ${events.length} events, each SHA-256 hash recomputed in this browser.`}
            {result.outsideLinks > 0 && ` ${result.outsideLinks} link(s) point to events outside this view and are checked in the Aimo view.`}
          </p>
          {children}
        </details>
      </div>
    );
  return (
    <div className="chain tone-stop" role="status" data-tour="chain">
      <ToneIcon tone="stop" />
      <div>
        <strong>Chain broken ✗</strong>
        <p>{`Event #${result.brokenAt} does not match its hash. It was changed after it was written.`}</p>
      </div>
    </div>
  );
}

function AgentTable({ events }: { events: AuditEvent[] }) {
  const agents = new Map<string, { mandate: string; orders: number; blocked: number }>();
  for (const e of events) {
    if (e.type !== 'order_decided') continue;
    const id = e.agentId ?? e.actor.id;
    const row = agents.get(id) ?? { mandate: String(e.data.mandateId ?? 'No valid mandate'), orders: 0, blocked: 0 };
    row.orders++;
    if (e.data.status === 'blocked') row.blocked++;
    agents.set(id, row);
  }
  return (
    <div className="card table-wrap">
      <table>
        <caption>Agents and mandates</caption>
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">Mandate</th>
            <th scope="col">Orders</th>
            <th scope="col">Blocked</th>
          </tr>
        </thead>
        <tbody>
          {[...agents].map(([id, row]) => (
            <tr key={id}>
              <th scope="row">{id}</th>
              <td>{row.mandate}</td>
              <td className="num">{row.orders}</td>
              <td className="num">{row.blocked}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `scope` comes from the view: 'buyer' is the Kitchen's own events, 'aimo' every event. */
export function AuditTrail({ api, scope }: { api: GatewayApi; scope: AuditScope }) {
  // shortcut: the mock's buyer scope holds every buyer's events, so the Kitchen keeps its own here; the real gateway filters by the signed-in buyer.
  const load = async () => (await api.listAuditEvents(scope)).filter((e) => scope === 'aimo' || !e.customerRef || e.customerRef === AURORA);
  const { data: events, error } = useLive(api, load, scope);

  return (
    <>
      <header className="page-head">
        <h1>Audit trail</h1>
      </header>

      <div>
        {error && (
          <p className="error" role="alert">
            Could not load the audit trail. {error}
          </p>
        )}
        {events && (
          <>
            <ChainStatus events={events}>
              {scope === 'aimo' && api instanceof MockGatewayApi && events.length > 1 && (
                <p>
                  <button type="button" className="btn" data-tour="tamper" onClick={() => void api.tamper(events[1]!.seq)}>
                    Demo: tamper with event #{events[1]!.seq}
                  </button>
                </p>
              )}
            </ChainStatus>
            {scope === 'aimo' && <AgentTable events={events} />}
            <section className="card" aria-label="What happened, newest first">
              {byDay([...events].reverse()).map(([dayLabel, list]) => (
                <div key={dayLabel} className="ev-day">
                  <h2 className="ev-day-title">{dayLabel}</h2>
                  <ol className="ev-list">
                    {byOrder(list).map((group) =>
                      group[0]!.orderId ? (
                        <OrderGroup key={group[0]!.seq} events={group} scope={scope} />
                      ) : (
                        <EventRow key={group[0]!.seq} event={group[0]!} scope={scope} />
                      ),
                    )}
                  </ol>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </>
  );
}
