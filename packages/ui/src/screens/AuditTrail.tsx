import { useEffect, useState } from 'react';
import { MockGatewayApi, type GatewayApi } from '../api';
import type { AuditEvent, AuditScope } from '../contract';
import { verifyChain, type ChainResult } from '../hash';
import { shortHash, time, ToneIcon, useLive } from '../ui';

const TABS: { scope: AuditScope; label: string; intro: string }[] = [
  { scope: 'buyer', label: 'Buyer view', intro: 'What my agent did and why.' },
  { scope: 'aimo', label: 'Aimo view', intro: 'Which agents ordered what, under which mandate.' },
];

const actorLabel = (actor: string) => (actor === 'human' ? 'Human' : actor === 'aimo' ? 'Aimo gateway' : `Agent ${actor}`);

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
            ? `${events.length} events, every SHA-256 hash recomputed in this browser.`
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
    if (e.kind !== 'decision') continue;
    const id = String(e.details.agentId ?? e.actor);
    const row = agents.get(id) ?? { mandate: String(e.details.mandateId ?? 'No valid mandate'), orders: 0, blocked: 0 };
    row.orders++;
    if (e.details.status === 'blocked') row.blocked++;
    agents.set(id, row);
  }
  return (
    <div className="table-wrap">
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
      <h1>Audit trail</h1>
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

      <div id="audit-panel" role="tabpanel" aria-labelledby={`tab-${scope}`}>
        <p className="lead">{tab.intro}</p>
        {error && (
          <p className="error" role="alert">
            Could not load the audit trail. {error}
          </p>
        )}
        {events && (
          <>
            <ChainStatus events={events} />
            {scope === 'aimo' && <AgentTable events={events} />}
            <ol className="events" reversed>
              {[...events].reverse().map((e) => (
                <li key={e.seq}>
                  <p className="muted">
                    #{e.seq}, {time(e.ts)}, {actorLabel(e.actor)}
                  </p>
                  <p>{e.summary}</p>
                  {scope === 'aimo' && (
                    <p className="muted">Mandate: {String(e.details.mandateId ?? 'no valid mandate')}</p>
                  )}
                  <p className="hashes">
                    <span title={e.hash}>hash {shortHash(e.hash)}</span>
                    <span title={e.prevHash}>
                      follows {e.seq === 1 ? 'genesis' : `#${e.seq - 1}`} {shortHash(e.prevHash)}
                    </span>
                    {e.orderId && <a href={`#/orders/${e.orderId}`}>{e.orderId}</a>}
                  </p>
                </li>
              ))}
            </ol>
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
