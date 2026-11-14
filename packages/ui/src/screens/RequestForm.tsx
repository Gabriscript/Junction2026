import { useState, type FormEvent } from 'react';
import type { ReasonCode } from '@junction/shared';
import type { GatewayApi } from '../api';
import type { MenuResult, UiOrder } from '../contract';
import { eur, ReasonChips, StatusBadge, whyText } from '../ui';

const LINE_STATUS: Record<MenuResult['lines'][number]['status'], { label: string; tone: 'ok' | 'warn' | 'stop' }> = {
  auto_approved: { label: 'Ordered', tone: 'ok' },
  needs_approval: { label: 'Needs your approval', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'stop' },
  not_ordered: { label: 'Not ordered', tone: 'stop' },
};

const COURSE: Record<string, string> = { appetizer: 'Appetizer', main: 'Main', dessert: 'Dessert' };

const qty = (n: number, unit: string) => `${n.toLocaleString('fi-FI', { maximumFractionDigits: 3 })} ${unit === 'ST' ? 'pcs' : unit.toLowerCase()}`;

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'Europe/Helsinki' }).format(new Date(`${iso}T12:00:00Z`));

function MenuPlanView({ result }: { result: MenuResult }) {
  const { plan, lines } = result;
  const ordered = lines.filter((l) => l.status === 'auto_approved').length;
  const waiting = lines.filter((l) => l.status === 'needs_approval').length;
  const stopped = lines.length - ordered - waiting;
  return (
    <>
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

      <section className="card" aria-labelledby="lines-h">
        <div className="card-head">
          <h2 id="lines-h">Shopping list</h2>
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
                  <strong>{l.name}</strong>
                  <span className="num">{qty(l.quantity, l.unit)}</span>
                </div>
                <p className="muted">
                  {l.product ?? 'No suitable product'}
                  {l.netEur !== undefined && <> · {eur(l.netEur)} excl. VAT</>}
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
        {waiting > 0 && (
          <p>
            <a className="btn primary" href="#/queue">
              Approve {waiting} {waiting === 1 ? 'line' : 'lines'}
            </a>
          </p>
        )}
      </section>
    </>
  );
}

export function RequestForm({ api }: { api: GatewayApi }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [order, setOrder] = useState<UiOrder>();
  const [menu, setMenu] = useState<MenuResult>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('Write or scan what you need first.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setOrder(undefined);
    setMenu(undefined);
    try {
      if (api.planMenu) setMenu(await api.planMenu(text.trim()));
      else setOrder(await api.submitRequest(text.trim()));
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>New request</h1>
      <p className="lead">Write or scan tonight's menu or reservation. The assistant plans the ingredients, orders what it may, and asks you about the rest.</p>
      <form onSubmit={submit} noValidate className="request-form">
        <label htmlFor="request-text">What do you need?</label>
        <p className="muted" id="request-hint">
          Example: Monday dinner, 10 people. Fusilli al pesto. Dessert: gelato vaniglia e cioccolato
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
        {menu && <MenuPlanView result={menu} />}
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
    </>
  );
}
