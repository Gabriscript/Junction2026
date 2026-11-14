import { useState, type FormEvent } from 'react';
import type { ReasonCode } from '@junction/shared';
import type { GatewayApi } from '../api';
import type { MenuResult, UiOrder } from '../contract';
import { UNIT_CODE_NAMES } from '@junction/shared';
import { eur, ReasonChips, StatusBadge, whyText } from '../ui';
import { ProductPhoto } from './Compact';

const LINE_STATUS: Record<MenuResult['lines'][number]['status'], { label: string; tone: 'ok' | 'warn' | 'stop' }> = {
  auto_approved: { label: 'Ordered', tone: 'ok' },
  needs_approval: { label: 'Needs your approval', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'stop' },
  not_ordered: { label: 'Not ordered', tone: 'stop' },
};

const packsText = (n: number, unit?: string) =>
  `${n.toLocaleString('fi-FI', { maximumFractionDigits: 2 })} ${(unit && UNIT_CODE_NAMES[unit as keyof typeof UNIT_CODE_NAMES]) ?? unit ?? ''}`.trim();

/** What Valio Aimo will deliver from this request: ordered lines with photo, packs × signed price and total. */
function WhatWasOrdered({ lines }: { lines: MenuResult['lines'] }) {
  const ordered = lines.filter((l) => l.status === 'auto_approved' && l.grossEur !== undefined);
  const waiting = lines.filter((l) => l.status === 'needs_approval' && l.grossEur !== undefined);
  if (ordered.length + waiting.length === 0) return null;
  const sum = (ls: typeof lines) => ls.reduce((n, l) => n + (l.grossEur ?? 0), 0);
  const row = (l: MenuResult['lines'][number]) => (
    <li key={`${l.orderId}-${l.name}`} className="compact-line">
      <ProductPhoto productId={l.productId} name={l.product ?? l.name} />
      <div className="compact-text">
        <strong>{l.product}</strong>
        <span className="muted">
          {packsText(l.packs ?? 0, l.salesUnit)} × {eur(l.unitPriceEur ?? 0)} · for {l.name}
        </span>
      </div>
      <span className="compact-price">{eur(l.grossEur ?? 0)}</span>
    </li>
  );
  return (
    <section className="card" aria-labelledby="ordered-h">
      <h2 id="ordered-h">What was ordered</h2>
      <ul className="compact-lines">{ordered.map(row)}</ul>
      <p className="ordered-total">
        <span>Ordered, incl. VAT</span> <strong>{eur(sum(ordered))}</strong>
      </p>
      {waiting.length > 0 && (
        <>
          <h3>Waiting for your OK</h3>
          <ul className="compact-lines">{waiting.map(row)}</ul>
          <p className="ordered-total">
            <span>If approved, incl. VAT</span> <strong>{eur(sum(waiting))}</strong>
          </p>
        </>
      )}
      <p className="muted signed-note">✓ Fixed prices from offers signed by Valio Aimo</p>
    </section>
  );
}

const COURSE: Record<string, string> = { appetizer: 'Appetizer', main: 'Main', dessert: 'Dessert' };

const qty = (n: number, unit: string) => `${n.toLocaleString('fi-FI', { maximumFractionDigits: 3 })} ${unit === 'ST' ? 'pcs' : unit.toLowerCase()}`;

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'Europe/Helsinki' }).format(new Date(`${iso}T12:00:00Z`));

function MenuPlanView({ result, title }: { result: MenuResult; title?: string }) {
  const { plan, lines } = result;
  const hasPlan = plan.dishes.length > 0;
  const ordered = lines.filter((l) => l.status === 'auto_approved').length;
  const waiting = lines.filter((l) => l.status === 'needs_approval').length;
  const stopped = lines.length - ordered - waiting;
  return (
    <>
      {title && <h2 className="result-title">{title}</h2>}
      {hasPlan && (
      <section className="card" aria-labelledby="plan-h">
        <h2 id="plan-h">Your plan</h2>
        <p className="request">
          {plan.meal ? `${plan.meal[0]!.toUpperCase()}${plan.meal.slice(1)}` : 'Order'} for {plan.servings} · delivery{' '}
          {plan.neededBy ? day(plan.neededBy) : 'next available day'}
        </p>
        <ul className="menu-dishes">
          {plan.dishes.map((d) => (
            <li key={d.dish}>
              {d.course && <span className="muted">{COURSE[d.course]}: </span>}
              {d.dish}
            </li>
          ))}
        </ul>
        {plan.unknownDishes.length > 0 && (
          <p className="notice">Please list the ingredients for: {plan.unknownDishes.join(', ')}</p>
        )}
        <h3>What the assistant assumed</h3>
        <ul className="menu-assumptions muted">
          {plan.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>
      )}

      <section className="card" aria-labelledby="lines-h">
        <div className="card-head">
          <h2 id="lines-h">{hasPlan ? 'Shopping list' : 'Added to your order'}</h2>
          <p className="muted">
            {ordered} ordered automatically · {waiting} need you{stopped ? ` · ${stopped} not ordered` : ''}
          </p>
        </div>
        <ul className="menu-lines">
          {lines.map((l) => {
            const s = LINE_STATUS[l.status];
            return (
              <li key={l.name} className="menu-line">
                <div className="menu-line-head">
                  <ProductPhoto productId={l.productId} name={l.product ?? l.name} size={48} />
                  <strong className="menu-line-name">{l.name}</strong>
                  <span className="qty">{qty(l.quantity, l.unit)}</span>
                </div>
                <p className="muted">
                  {l.product ?? 'No suitable product'}
                  {l.packs !== undefined && l.unitPriceEur !== undefined && (
                    <> · {packsText(l.packs, l.salesUnit)} × {eur(l.unitPriceEur)}</>
                  )}
                </p>
                <span className={`badge tone-${s.tone}`}>{s.label}</span>
                <ReasonChips codes={l.reasonCodes as ReasonCode[]} />
                {l.orderId && l.status !== 'auto_approved' && (
                  <p>
                    <a href={`#/orders/${l.orderId}`}>Review and decide</a>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {!hasPlan && plan.assumptions.length > 0 && <p className="muted">{plan.assumptions.join(' · ')}</p>}
        {waiting > 0 && (
          <p>
            <a className="btn primary" href="#/queue">
              Approve {waiting} {waiting === 1 ? 'line' : 'lines'}
            </a>
          </p>
        )}
      </section>

      <WhatWasOrdered lines={lines} />
    </>
  );
}

export function RequestForm({ api }: { api: GatewayApi }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [order, setOrder] = useState<UiOrder>();
  const [results, setResults] = useState<MenuResult[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('Write or scan what you need first.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setOrder(undefined);
    setResults([]);
    try {
      if (api.planMenu) setResults([await api.planMenu(text.trim())]);
      else setOrder(await api.submitRequest(text.trim()));
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const sendFollowUp = async (e: FormEvent) => {
    e.preventDefault();
    if (!api.planMenu || !followUp.trim()) {
      setFollowError('Write a correction or what to add first.');
      return;
    }
    setFollowBusy(true);
    setFollowError(undefined);
    try {
      const result = await api.planMenu(followUp.trim(), { neededBy: results[0]?.plan.neededBy ?? null });
      setResults((prev) => [...prev, result]);
      setFollowUp('');
    } catch (err) {
      setFollowError(err instanceof Error ? err.message : String(err));
    } finally {
      setFollowBusy(false);
    }
  };

  return (
    <>
      <h1>New request</h1>
      <p className="lead">Write or scan tonight's menu or reservation. The assistant plans the ingredients, orders what it may, and asks you about the rest.</p>
      <form onSubmit={submit} noValidate className="request-form">
        <label htmlFor="request-text">What do you need?</label>
        <p className="muted" id="request-hint">
          Example: Wednesday dinner, 10 people. Fusilli al pesto. Dessert: gelato vaniglia e cioccolato
        </p>
        <textarea
          id="request-text"
          rows={5}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={error ? 'request-hint request-error' : 'request-hint'}
          aria-invalid={error ? true : undefined}
        />
        {error && (
          <p className="error" id="request-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Planning and ordering...' : 'Send to assistant'}
        </button>
      </form>

      <div role="status" aria-live="polite">
        {results.map((r, i) => (
          <MenuPlanView key={i} result={r} title={i === 0 ? undefined : `Update ${i}`} />
        ))}
        {order && (
          <section className="card" aria-label="Result">
            <div className="card-head">
              <h2>Order {order.orderId}</h2>
              <StatusBadge status={order.status} />
            </div>
            <ReasonChips codes={order.decision.reasonCodes} />
            {whyText(order).map((text, i) => (
              <p key={i}>{text}</p>
            ))}
            <p>
              <a href={`#/orders/${order.orderId}`}>Open decision record for {order.orderId}</a>
            </p>
          </section>
        )}
      </div>

      {results.length > 0 && (
        <form onSubmit={sendFollowUp} noValidate className="request-form follow-up">
          <label htmlFor="follow-text">Correction or new order</label>
          <p className="muted" id="follow-hint">
            Example: add 2 kg parmesan · also 1 kg mozzarella · or a new dish. Delivery stays the same day.
          </p>
          <textarea
            id="follow-text"
            rows={2}
            maxLength={2000}
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            aria-describedby={followError ? 'follow-hint follow-error' : 'follow-hint'}
            aria-invalid={followError ? true : undefined}
          />
          {followError && (
            <p className="error" id="follow-error" role="alert">
              {followError}
            </p>
          )}
          <button type="submit" className="btn primary" disabled={followBusy}>
            {followBusy ? 'Ordering...' : 'Send to assistant'}
          </button>
        </form>
      )}
    </>
  );
}
