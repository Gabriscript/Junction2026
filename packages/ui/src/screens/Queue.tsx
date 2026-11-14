import { useEffect, useRef, useState } from 'react';
import type { GatewayApi } from '../api';
import { eur, Icon, ReasonChips, StatusBadge, time, useLive } from '../ui';
import { CompactLines, SignedPriceNote } from './Compact';
import { ReviewActions } from './OrderParts';

export function Queue({ api }: { api: GatewayApi }) {
  const { data: orders, error, refresh } = useLive(api, () => api.listOrders(), 'orders');
  const [announcement, setAnnouncement] = useState('');
  const known = useRef<Set<string> | null>(null);

  const all = orders ?? [];
  const pending = all.filter((o) => o.status === 'pending_approval');
  const others = all.filter((o) => o.status !== 'pending_approval').reverse();

  // Announce orders that start waiting after the first load.
  useEffect(() => {
    if (!orders) return;
    const ids = new Set(pending.map((o) => o.orderId));
    if (known.current) {
      const fresh = pending.filter((o) => !known.current!.has(o.orderId));
      if (fresh.length > 0) {
        setAnnouncement(`New order needs approval: ${fresh.map((o) => `${o.orderId} from ${o.buyerName}`).join(', ')}.`);
      }
    }
    known.current = ids;
  }, [orders]);

  return (
    <>
      <header className="page-head">
        <h1>Approvals</h1>
      </header>
      <p className="notice" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && (
        <p className="error" role="alert">
          Could not load orders. {error}
        </p>
      )}

      {orders && pending.length === 0 && <p className="empty card">Nothing is waiting for approval.</p>}
      {pending.map((order) => (
        <article key={order.orderId} className="card order-card compact" aria-labelledby={`title-${order.orderId}`}>
          <div className="card-head">
            <h2 id={`title-${order.orderId}`}>
              <a href={`#/orders/${order.orderId}`}>{order.buyerName}</a>
            </h2>
            <a className="icon-btn" href={`#/orders/${order.orderId}`} aria-label="Why and proof">
              <Icon name="next" />
            </a>
          </div>
          <CompactLines order={order} />
          <ReasonChips codes={order.decision.reasonCodes} />
          <SignedPriceNote order={order} />
          <ReviewActions api={api} order={order} onDone={refresh} />
        </article>
      ))}

      <details className="card more">
        <summary>Done</summary>
        {orders && others.length === 0 && <p className="empty">No decided orders yet.</p>}
        {others.length > 0 && (
          <div className="table-wrap">
            <table className="orders">
              <thead>
                <tr>
                  <th scope="col">Buyer</th>
                  <th scope="col" className="hide-sm">
                    Received
                  </th>
                  <th scope="col" className="hide-sm num-col">
                    Total incl. VAT
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {others.map((order) => (
                  <tr key={order.orderId}>
                    <th scope="row">
                      <a href={`#/orders/${order.orderId}`}>{order.buyerName}</a>
                      <span className="muted">
                        {order.orderId}
                        <span className="show-sm">, {eur(order.totals.gross)}</span>
                      </span>
                    </th>
                    <td className="hide-sm muted">{time(order.createdAt)}</td>
                    <td className="hide-sm num num-col">{eur(order.totals.gross)}</td>
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </>
  );
}
