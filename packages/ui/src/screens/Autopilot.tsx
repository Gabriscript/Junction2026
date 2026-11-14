// Mikko's Autopilot: the kitchen's usual items, on the rhythm read from its last 12 weeks, ordered without the chef asking.
import { useState } from 'react';
import type { GatewayApi } from '../api';
import type { UiOrder } from '../contract';
import { history, parLevels, THIS_MONDAY, type WeekOrder } from '../kitchen';
import { totalsFromNet } from '@junction/shared';
import { toPacks } from '../aimoProducts';
import { eur, Icon, StatusBadge } from '../ui';
import { packs, ProductFacts, ProductPhoto } from './Compact';

const rhythm = (every: number) => (every === 1 ? 'weekly' : every === 4 ? 'monthly' : `every ${every} weeks`);
const round = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
const addWeeks = (monday: string, n: number) => new Date(Date.parse(`${monday}T00:00:00Z`) + n * 7 * 86_400_000).toISOString().slice(0, 10);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const label = (item: string) => item.charAt(0).toUpperCase() + item.slice(1);

/**
 * One row per usual item: median quantity, how often, next delivery (this Monday if it is due), and the cart line:
 * whole packs at the real Aimo price, gross incl. VAT the same way an order line counts it.
 */
const USUALS = [...parLevels(history)]
  .map(([item, p]) => {
    const quantity = round(p.median);
    const cart = toPacks(item, quantity);
    return {
      item,
      quantity,
      unit: p.unit,
      every: p.every,
      next: addWeeks(THIS_MONDAY, Math.max(0, p.every - p.weeksSince)),
      cart,
      gross: cart ? totalsFromNet(cart.packs * cart.product.price, 13.5).gross : 0,
    };
  })
  .sort((a, b) => a.every - b.every);

export function Autopilot({ api }: { api: GatewayApi }) {
  const [on, setOn] = useState(false);
  const [askMe, setAskMe] = useState<Set<string>>(() => new Set());
  const [sent, setSent] = useState<UiOrder>();
  const [error, setError] = useState('');
  const due = USUALS.filter((u) => u.next === THIS_MONDAY && !askMe.has(u.item));
  // Aimo price API answer for 16 Nov; the order itself carries the prices Valio Aimo signs at send time.
  const gross = due.reduce((s, u) => s + Math.round(u.gross * 100), 0) / 100;

  const toggle = async () => {
    setOn(!on);
    setError('');
    if (on || sent || due.length === 0) return;
    const lines: WeekOrder[] = due.map(({ item, quantity, unit }) => ({ item, quantity, unit }));
    try {
      setSent(await api.submitWeek(lines, `Usual order for ${day(THIS_MONDAY)}: ${lines.map((l) => `${l.quantity} ${l.unit} ${l.item}`).join(', ')}`));
    } catch (err) {
      setOn(false);
      setError(`Mikko could not send the usual order. ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const flip = (item: string) => {
    const next = new Set(askMe);
    if (!next.delete(item)) next.add(item);
    setAskMe(next);
  };

  return (
    <section className="card autopilot" aria-labelledby="ap-title" data-tour="autopilot">
      <div className="card-head">
        <p className="stat-title">
          <span className="tile">
            <Icon name="bolt" />
          </span>
          <strong id="ap-title">Autopilot</strong>
        </p>
        <button type="button" role="switch" aria-checked={on} aria-labelledby="ap-title" className="switch" onClick={toggle}>
          <span aria-hidden="true">{on ? 'On' : 'Off'}</span>
          <span className="switch-track" aria-hidden="true">
            <span className="switch-knob" />
          </span>
        </button>
      </div>

      <p className="ap-status" role="status">
        {sent ? (
          <>
            Sent by Mikko <StatusBadge status={sent.status} /> <a href={`#/orders/${sent.orderId}`}>See order</a>
          </>
        ) : on ? (
          'Mikko is sending the usual order…'
        ) : null}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <details className="more ap-fold">
        <summary>
          <span className="ap-next">
            <strong>Next delivery {day(THIS_MONDAY)}</strong>
            <span className="muted">
              {due.length} items, <span className="num">{eur(gross)}</span>
            </span>
          </span>
        </summary>
        <ul className="compact-lines" aria-label="Usual items">
          {USUALS.map((u) => (
            <li key={u.item} className={askMe.has(u.item) ? 'compact-line ap-off' : 'compact-line'}>
              <ProductPhoto productId={u.cart?.product.productId} name={u.item} size={48} />
              <div className="compact-text">
                <strong>{u.cart?.product.name ?? label(u.item)}</strong>
                <span className="muted">{u.cart ? `${packs(u.cart.packs, u.cart.product.salesUnit)} · ${eur(u.cart.product.price)}` : `${u.quantity} ${u.unit}`}</span>
                <span className="ap-when">
                  {label(rhythm(u.every))} · {u.next === THIS_MONDAY ? 'due now' : `next ${day(u.next)}`}
                </span>
                <ProductFacts productId={u.cart?.product.productId} />
              </div>
              {u.cart && <span className="compact-price">{eur(u.gross)}</span>}
              <label className="ask-me">
                <input type="checkbox" aria-label={`Ask me before ordering ${u.item}`} checked={askMe.has(u.item)} onChange={() => flip(u.item)} />
                Ask me
              </label>
            </li>
          ))}
        </ul>

        <p className="ap-rules-title">How Mikko decides</p>
        <ul className="ap-rules">
          <li>Quantity and rhythm come from your last 12 weeks.</li>
          <li>Every price is signed by Valio Aimo before the order goes out.</li>
          <li>Above your mandate limit, or anything unusual, waits in Approvals.</li>
          <li>Items marked Ask me are never ordered automatically.</li>
        </ul>
      </details>
    </section>
  );
}
