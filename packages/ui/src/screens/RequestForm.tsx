import { useState, type FormEvent } from 'react';
import type { ReasonCode } from '@junction/shared';
import type { GatewayApi } from '../api';
import type { MenuResult, UiOrder } from '../contract';
import { UNIT_CODE_NAMES } from '@junction/shared';
import { eur, ReasonChips, StatusBadge, whyText } from '../ui';
import { ProductPhoto } from './Compact';
import { CaptureBar } from './Capture';

const LINE_STATUS: Record<MenuResult['lines'][number]['status'], { label: string; tone: 'ok' | 'warn' | 'stop' }> = {
  auto_approved: { label: 'Ordered', tone: 'ok' },
  needs_approval: { label: 'Needs your OK', tone: 'warn' },
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
  const waiting = lines.filter((l) => l.status === 'needs_approval').length;
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
        <h3>What Mikko assumed</h3>
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
                <p className="muted">{l.product ?? 'No suitable product'}</p>
                <span className={`badge tone-${s.tone}`}>{s.label}</span>
                <ReasonChips codes={l.reasonCodes as ReasonCode[]} />
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

  // One composer: a new request first, then corrections to the plan on screen (same delivery day).
  const started = results.length > 0;
  const [value, setValue] = started ? [followUp, setFollowUp] : [text, setText];
  const shownError = started ? followError : error;

  return (
    <div className="new-order">
      <h1 className={started || order ? 'visually-hidden' : 'new-order-greet'}>What do you need, chef?</h1>

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

      <form onSubmit={started ? sendFollowUp : submit} noValidate className="request-form composer-dock">
        {shownError && (
          <p className="error" id="request-error" role="alert">
            {shownError}
          </p>
        )}
        <label htmlFor="request-text" className="visually-hidden">
          {started ? 'Correction or new order' : 'What do you need?'}
        </label>
        <CaptureBar
          api={api}
          hasText={!!value.trim()}
          working={busy ? 'Planning and ordering…' : followBusy ? 'Ordering…' : undefined}
          onText={(t, mode) => setValue((prev) => (mode === 'append' && prev.trim() ? `${prev.trim()} ${t}` : t))}
        >
          <textarea
            id="request-text"
            rows={1}
            maxLength={2000}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ask Mikko…"
            aria-describedby={shownError ? 'request-error' : undefined}
            aria-invalid={shownError ? true : undefined}
          />
        </CaptureBar>
      </form>
    </div>
  );
}
