import { useEffect, useRef, useState } from 'react';
import type { GatewayApi } from '../api';
import { eur, orderTotals, StatusBadge, useLive } from '../ui';
import { Cart, DecisionSummary, ReviewActions } from './OrderParts';

export function Queue({ api }: { api: GatewayApi }) {
  const { data: orders, error, refresh } = useLive(api, () => api.listOrders(), 'orders');
  const [announcement, setAnnouncement] = useState('');
  const known = useRef<Set<string> | null>(null);

  const pending = orders?.filter((o) => o.status === 'needs_approval') ?? [];
  const others = orders?.filter((o) => o.status !== 'needs_approval').reverse() ?? [];

  // Announce orders that start waiting after the first load.
  useEffect(() => {
    if (!orders) return;
    const ids = new Set(pending.map((o) => o.orderId));
    if (known.current) {
      const fresh = pending.filter((o) => !known.current!.has(o.orderId));
      if (fresh.length > 0) {
        setAnnouncement(`New order needs approval: ${fresh.map((o) => `${o.orderId} from ${o.buyer}`).join(', ')}.`);
      }
    }
    known.current = ids;
  }, [orders]);

  return (
    <>
      <h1>Approval queue</h1>
      <p className="lead">Orders that AI purchasing agents may not place on their own.</p>
      <p className="notice" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && (
        <p className="error" role="alert">
          Could not load orders. {error}
        </p>
      )}

      <section aria-labelledby="pending-title">
        <h2 id="pending-title">Waiting for you ({pending.length})</h2>
        {orders && pending.length === 0 && <p className="empty">Nothing is waiting for approval.</p>}
        {pending.map((order) => (
          <article key={order.orderId} className="card" aria-labelledby={`title-${order.orderId}`}>
            <header className="card-head">
              <div>
                <h3 id={`title-${order.orderId}`}>{order.buyer}</h3>
                <p className="muted">
                  {order.agentName} ({order.agentId}), order {order.orderId}
                </p>
              </div>
              <StatusBadge status={order.status} />
            </header>
            <p className="request">Request: {order.requestText}</p>
            <Cart order={order} />
            <DecisionSummary order={order} />
            <ReviewActions api={api} order={order} onDone={refresh} />
            <p>
              <a href={`#/orders/${order.orderId}`}>Open decision record for {order.orderId}</a>
            </p>
          </article>
        ))}
      </section>

      <section aria-labelledby="others-title">
        <h2 id="others-title">Decided orders</h2>
        {orders && others.length === 0 && <p className="empty">No decided orders yet.</p>}
        <ul className="rows">
          {others.map((order) => (
            <li key={order.orderId}>
              <a className="row-link" href={`#/orders/${order.orderId}`}>
                <span>
                  <strong>{order.buyer}</strong>
                  <span className="muted">
                    {order.orderId}, {eur(orderTotals(order).gross)} incl. VAT
                  </span>
                </span>
                <StatusBadge status={order.status} />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
