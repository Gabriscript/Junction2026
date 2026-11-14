import { useEffect, useState } from 'react';
import { MockGatewayApi, type GatewayApi } from '../api';
import { REASON_CODE_INFO, type Actor, type AuditEvent } from '@junction/shared';
import type { AuditScope } from '../contract';
import { verifyChain, type ChainResult } from '../hash';
import { eur, Icon, shortHash, ToneIcon, useLive } from '../ui';

const TABS: { scope: AuditScope; label: string; intro: string }[] = [
  { scope: 'buyer', label: 'Buyer view', intro: 'What my agent did and why.' },
  { scope: 'aimo', label: 'Aimo view', intro: 'Which agents ordered what, under which mandate.' },
];

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

const TONE_ICON: Record<Tone, 'ok' | 'warn' | 'stop'> = { ok: 'ok', warn: 'warn', stop: 'stop', info: 'ok' };

function EventRow({ event: e, scope }: { event: AuditEvent; scope: AuditScope }) {
  const { tone, title, detail } = describe(e, scope);
  return (
    <li className={`ev ev-${tone}`}>
      <span className="ev-dot" aria-hidden="true">
        {tone === 'info' ? <Icon name="shield" size={16} /> : <ToneIcon tone={TONE_ICON[tone]} />}
      </span>
      <div className="ev-body">
        <p className="ev-title">{title}</p>
        {detail && <p className="ev-detail">{detail}</p>}
        <p className="ev-meta">
          <time dateTime={e.at}>{clock(e.at)}</time>
          <span>{actorLabel(e.actor, scope)}</span>
          {e.orderId && <a href={`#/orders/${e.orderId}`}>Order {e.orderId}</a>}
          {scope === 'aimo' && <span>Mandate {String(e.data.mandateId ?? 'none')}</span>}
        </p>
        <details className="ev-proof">
          <summary>Proof #{e.seq}</summary>
          <p className="hashes">
            <span title={e.hash}>hash {shortHash(e.hash)}</span>
            <span title={e.prevHash}>
              follows {e.seq === 0 ? 'genesis' : `#${e.seq - 1}`} {shortHash(e.prevHash)}
            </span>
          </p>
          <p className="ev-raw">{e.summary}</p>
        </details>
      </div>
    </li>
  );
}

function ChainStatus({ events }: { events: AuditEvent[] }) {
  const [result, setResult] = useState<ChainResult>();

  useEffect(() => {
    let active = true;
    verifyChain(events).then((r) => active && setResult(r));
    return () => {
      active = false;
    };
  }, [events]);

  if (!result) return <p className="chain" role="status">Checking the hash chain...</p>;
  return (
    <div className={`chain tone-${result.ok ? 'ok' : 'stop'}`} role="status">
      <ToneIcon tone={result.ok ? 'ok' : 'stop'} />
      <div>
        <strong>{result.ok ? 'Chain verified ✓' : 'Chain broken ✗'}</strong>
        <p>
          {result.ok
            ? `Nothing was changed after it was written: ${events.length} events, each SHA-256 hash recomputed in this browser.`
            : `Event #${result.brokenAt} does not match its hash. It was changed after it was written.`}
          {result.ok && result.outsideLinks > 0 &&
            ` ${result.outsideLinks} link(s) point to events outside this view and are checked in the Aimo view.`}
        </p>
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

export function AuditTrail({ api }: { api: GatewayApi }) {
  const [scope, setScope] = useState<AuditScope>('buyer');
  const { data: events, error } = useLive(api, () => api.listAuditEvents(scope), scope);
  const tab = TABS.find((t) => t.scope === scope)!;

  return (
    <>
      <header className="page-head page-head-row">
        <div>
          <h1>Audit trail</h1>
          <p className="lead">Every offer, order and decision, chained by SHA-256 hashes.</p>
        </div>
        <div className="tabs" role="tablist" aria-label="Audit views">
        {TABS.map((t) => (
          <button
            key={t.scope}
            type="button"
            role="tab"
            id={`tab-${t.scope}`}
            aria-selected={t.scope === scope}
            aria-controls="audit-panel"
            onClick={() => setScope(t.scope)}
          >
            {t.label}
          </button>
        ))}
        </div>
      </header>

      <div id="audit-panel" role="tabpanel" aria-labelledby={`tab-${scope}`}>
        <p className="muted">{tab.intro}</p>
        {error && (
          <p className="error" role="alert">
            Could not load the audit trail. {error}
          </p>
        )}
        {events && (
          <>
            <ChainStatus events={events} />
            {scope === 'aimo' && <AgentTable events={events} />}
            <section className="card" aria-labelledby="events-title">
              <h2 id="events-title" className="card-title">
                What happened, newest first
              </h2>
              {byDay([...events].reverse()).map(([dayLabel, list]) => (
                <div key={dayLabel} className="ev-day">
                  <h3 className="ev-day-title">{dayLabel}</h3>
                  <ol className="ev-list">
                    {list.map((e) => (
                      <EventRow key={e.seq} event={e} scope={scope} />
                    ))}
                  </ol>
                </div>
              ))}
            </section>
            {api instanceof MockGatewayApi && events.length > 1 && (
              <p>
                <button type="button" className="btn" onClick={() => void api.tamper(events[1]!.seq)}>
                  Demo: tamper with event #{events[1]!.seq}
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
